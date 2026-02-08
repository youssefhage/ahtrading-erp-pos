from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..db import get_conn, get_admin_conn, set_company_context
from ..deps import get_current_user, require_company_access, get_company_id, require_permission

router = APIRouter(prefix="/companies", tags=["companies"], dependencies=[Depends(get_current_user)])


class CompanyIn(BaseModel):
    name: str
    legal_name: Optional[str] = None
    registration_no: Optional[str] = None
    vat_no: Optional[str] = None
    base_currency: str = "USD"
    vat_currency: str = "LBP"
    default_rate_type: str = "market"


@router.get("")
def list_companies(user=Depends(get_current_user)):
    # Note: `companies` table is not RLS-restricted. We only return companies the user
    # has roles in.
    # Use the admin connection because `user_roles` is RLS-protected and this query
    # spans multiple companies.
    with get_admin_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT c.id, c.name, c.legal_name, c.registration_no, c.vat_no,
                       c.base_currency, c.vat_currency, c.default_rate_type
                FROM companies c
                JOIN user_roles ur ON ur.company_id = c.id
                WHERE ur.user_id = %s
                ORDER BY c.name
                """,
                (user["user_id"],),
            )
            return {"companies": cur.fetchall()}


@router.get("/{company_id}")
def get_company(company_id: str, user=Depends(get_current_user)):
    # Use the admin connection because we need to check membership without relying
    # on a pre-selected company context.
    with get_admin_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1 FROM user_roles
                WHERE user_id = %s AND company_id = %s
                """,
                (user["user_id"], company_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=403, detail="no company access")

            cur.execute(
                """
                SELECT id, name, legal_name, registration_no, vat_no,
                       base_currency, vat_currency, default_rate_type,
                       created_at, updated_at
                FROM companies
                WHERE id = %s
                """,
                (company_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="company not found")
            return {"company": row}


@router.post("", dependencies=[Depends(require_company_access), Depends(require_permission("users:write"))])
def create_company(
    data: CompanyIn,
    _company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    # Creating companies is a privileged operation. For now we gate it behind
    # `users:write` in an existing company (header X-Company-Id), so only admins can bootstrap more companies.
    with get_conn() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO companies
                      (id, name, legal_name, registration_no, vat_no, base_currency, vat_currency, default_rate_type)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s::currency_code, %s::currency_code, %s::rate_type)
                    RETURNING id
                    """,
                    (
                        data.name,
                        data.legal_name,
                        data.registration_no,
                        data.vat_no,
                        data.base_currency,
                        data.vat_currency,
                        data.default_rate_type,
                    ),
                )
                new_company_id = cur.fetchone()["id"]

            # From here on, set company context so RLS-protected tables can be written.
            set_company_context(conn, new_company_id)

            with conn.cursor() as cur:
                # Default branch + warehouse
                cur.execute(
                    """
                    INSERT INTO branches (id, company_id, name, address)
                    VALUES (gen_random_uuid(), %s, 'Main', NULL)
                    RETURNING id
                    """,
                    (new_company_id,),
                )
                branch_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO warehouses (id, company_id, name, location)
                    VALUES (gen_random_uuid(), %s, 'Main Warehouse', NULL)
                    RETURNING id
                    """,
                    (new_company_id,),
                )
                warehouse_id = cur.fetchone()["id"]

                # Create an admin role and grant all permissions.
                cur.execute(
                    """
                    INSERT INTO roles (id, company_id, name)
                    VALUES (gen_random_uuid(), %s, 'Admin')
                    RETURNING id
                    """,
                    (new_company_id,),
                )
                role_id = cur.fetchone()["id"]

                cur.execute("SELECT id FROM permissions")
                perm_ids = [r["id"] for r in cur.fetchall()]
                for pid in perm_ids:
                    cur.execute(
                        """
                        INSERT INTO role_permissions (role_id, permission_id)
                        VALUES (%s, %s)
                        ON CONFLICT DO NOTHING
                        """,
                        (role_id, pid),
                    )

                # Assign creator to the new company admin role.
                cur.execute(
                    """
                    INSERT INTO user_roles (user_id, role_id, company_id)
                    VALUES (%s, %s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (user["user_id"], role_id, new_company_id),
                )

                # Default background job schedules (AI agents + executor).
                # Jobs are recommendation-first; auto-execution is still gated by ai_agent_settings.
                cur.execute(
                    """
                    INSERT INTO background_job_schedules (company_id, job_code, enabled, interval_seconds, options_json, next_run_at)
                    VALUES
                      (%s, 'AI_INVENTORY', true, 3600, '{}'::jsonb, now()),
                      (%s, 'AI_PURCHASE', true, 3600, '{}'::jsonb, now()),
                      (%s, 'AI_CRM', true, 86400, '{"inactive_days": 60}'::jsonb, now()),
                      (%s, 'AI_PRICING', true, 86400, '{"min_margin_pct": 0.05, "target_margin_pct": 0.15}'::jsonb, now()),
                      (%s, 'AI_SHRINKAGE', true, 3600, '{}'::jsonb, now()),
                      (%s, 'AI_EXECUTOR', true, 60, '{}'::jsonb, now())
                    ON CONFLICT (company_id, job_code) DO NOTHING
                    """,
                    (new_company_id, new_company_id, new_company_id, new_company_id, new_company_id, new_company_id),
                )

            return {
                "id": new_company_id,
                "default_branch_id": branch_id,
                "default_warehouse_id": warehouse_id,
            }
