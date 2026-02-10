from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
from ..security import hash_password
import json

router = APIRouter(prefix="/users", tags=["users"])


class UserIn(BaseModel):
    email: str
    password: str


class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None


class RoleIn(BaseModel):
    name: str


class RoleAssignIn(BaseModel):
    user_id: str
    role_id: str


@router.get("", dependencies=[Depends(require_permission("users:read"))])
def list_users(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT u.id, u.email, u.full_name, u.phone, u.is_active, u.mfa_enabled
                FROM users u
                JOIN user_roles ur ON ur.user_id = u.id
                WHERE ur.company_id = %s
                ORDER BY u.email
                """,
                (company_id,),
            )
            return {"users": cur.fetchall()}


@router.get("/me", dependencies=[Depends(require_permission("users:read"))])
def me(company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    # Company-scoped "me" view (safe for Admin UI).
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT u.id, u.email, u.full_name, u.phone, u.is_active, u.mfa_enabled, u.created_at, u.updated_at
                FROM users u
                WHERE u.id = %s
                """,
                (user["user_id"],),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="user not found")
            return {"user": row}


@router.patch("/me", dependencies=[Depends(require_permission("users:read"))])
def update_me(
    data: UserProfileUpdate,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    patch = {k: getattr(data, k) for k in getattr(data, "model_fields_set", set())}
    if "full_name" in patch:
        patch["full_name"] = (patch.get("full_name") or "").strip() or None
    if "phone" in patch:
        patch["phone"] = (patch.get("phone") or "").strip() or None
    if not patch:
        return {"ok": True}

    fields = []
    params = []
    for k, v in patch.items():
        fields.append(f"{k} = %s")
        params.append(v)
    params.append(user["user_id"])

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE users
                SET {', '.join(fields)}, updated_at = now()
                WHERE id = %s
                """,
                params,
            )
    return {"ok": True}


@router.post("", dependencies=[Depends(require_permission("users:write"))])
def create_user(data: UserIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (id, email, hashed_password)
                VALUES (gen_random_uuid(), %s, %s)
                RETURNING id
                """,
                (data.email, hash_password(data.password)),
            )
            uid = cur.fetchone()["id"]
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'users.create', 'user', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], uid, json.dumps({"email": data.email})),
            )
            return {"id": uid}


@router.post("/{user_id}/mfa/reset", dependencies=[Depends(require_permission("users:write"))])
def reset_user_mfa(user_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Admin operation: disable MFA for a user and revoke their sessions (account recovery).
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                # Only allow acting on users that belong to this company.
                cur.execute(
                    """
                    SELECT 1
                    FROM user_roles
                    WHERE user_id = %s AND company_id = %s
                    LIMIT 1
                    """,
                    (user_id, company_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="user not found")

                cur.execute(
                    """
                    UPDATE users
                    SET mfa_enabled = false,
                        mfa_secret_enc = NULL,
                        mfa_pending_secret_enc = NULL,
                        mfa_verified_at = NULL,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (user_id,),
                )
                cur.execute(
                    """
                    UPDATE auth_sessions
                    SET is_active = false
                    WHERE user_id = %s
                    """,
                    (user_id,),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'users.mfa.reset', 'user', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], user_id, json.dumps({})),
                )
                return {"ok": True}


@router.get("/roles", dependencies=[Depends(require_permission("users:read"))])
def list_roles(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name
                FROM roles
                WHERE company_id = %s
                ORDER BY name
                """,
                (company_id,),
            )
            return {"roles": cur.fetchall()}


@router.post("/roles", dependencies=[Depends(require_permission("users:write"))])
def create_role(data: RoleIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO roles (id, company_id, name)
                VALUES (gen_random_uuid(), %s, %s)
                RETURNING id
                """,
                (company_id, data.name),
            )
            rid = cur.fetchone()["id"]
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'users.role.create', 'role', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], rid, json.dumps({"name": data.name})),
            )
            return {"id": rid}


@router.post("/roles/assign", dependencies=[Depends(require_permission("users:write"))])
def assign_role(data: RoleAssignIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            # ensure role belongs to company
            cur.execute("SELECT id FROM roles WHERE id = %s AND company_id = %s", (data.role_id, company_id))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="role not found")
            cur.execute(
                """
                INSERT INTO user_roles (user_id, role_id, company_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, role_id) DO NOTHING
                """,
                (data.user_id, data.role_id, company_id),
            )
            # Role changes should invalidate sessions so permissions update immediately.
            cur.execute(
                """
                UPDATE auth_sessions
                SET is_active = false
                WHERE user_id = %s
                """,
                (data.user_id,),
            )
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'users.role.assign', 'user', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], data.user_id, json.dumps({"role_id": data.role_id})),
            )
            return {"ok": True}


class RolePermissionIn(BaseModel):
    role_id: str
    permission_code: str


@router.get("/permissions", dependencies=[Depends(require_permission("users:read"))])
def list_permissions(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, description
                FROM permissions
                ORDER BY code
                """,
            )
            return {"permissions": cur.fetchall()}


@router.get("/roles/{role_id}/permissions", dependencies=[Depends(require_permission("users:read"))])
def list_role_permissions(role_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.code, p.description
                FROM role_permissions rp
                JOIN permissions p ON p.id = rp.permission_id
                WHERE rp.role_id = %s
                ORDER BY p.code
                """,
                (role_id,),
            )
            return {"permissions": cur.fetchall()}


@router.post("/roles/permissions", dependencies=[Depends(require_permission("users:write"))])
def assign_role_permission(data: RolePermissionIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM roles WHERE id = %s AND company_id = %s",
                (data.role_id, company_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="role not found")
            cur.execute(
                "SELECT id FROM permissions WHERE code = %s",
                (data.permission_code,),
            )
            perm = cur.fetchone()
            if not perm:
                raise HTTPException(status_code=404, detail="permission not found")
            cur.execute(
                """
                INSERT INTO role_permissions (role_id, permission_id)
                VALUES (%s, %s)
                ON CONFLICT (role_id, permission_id) DO NOTHING
                """,
                (data.role_id, perm["id"]),
            )
            # Permission changes should invalidate sessions for users with this role.
            cur.execute(
                """
                UPDATE auth_sessions
                SET is_active = false
                WHERE user_id IN (
                  SELECT user_id
                  FROM user_roles
                  WHERE company_id = %s AND role_id = %s
                )
                """,
                (company_id, data.role_id),
            )
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'users.role_permission.assign', 'role', %s, %s::jsonb)
                """,
                (
                    company_id,
                    user["user_id"],
                    data.role_id,
                    json.dumps({"permission_code": data.permission_code}),
                ),
            )
            return {"ok": True}


@router.post("/{user_id}/sessions/revoke", dependencies=[Depends(require_permission("users:write"))])
def revoke_user_sessions(user_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Company-admin operation: revoke all auth sessions for a user in this company.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            # Only allow revoking sessions for users that belong to this company.
            cur.execute(
                """
                SELECT 1
                FROM user_roles
                WHERE user_id = %s AND company_id = %s
                LIMIT 1
                """,
                (user_id, company_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="user not found")

            cur.execute(
                """
                UPDATE auth_sessions
                SET is_active = false
                WHERE user_id = %s
                """,
                (user_id,),
            )
            revoked = cur.rowcount
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'users.sessions.revoke', 'user', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], user_id, json.dumps({"revoked": revoked})),
            )
            return {"ok": True, "revoked": revoked}


@router.post("/sessions/revoke-all", dependencies=[Depends(require_permission("users:write"))])
def revoke_all_company_sessions(company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Company-admin incident-response operation: revoke all sessions for all users that belong to this company.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE auth_sessions
                SET is_active = false
                WHERE user_id IN (
                  SELECT DISTINCT user_id
                  FROM user_roles
                  WHERE company_id = %s
                )
                """,
                (company_id,),
            )
            revoked = cur.rowcount
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'users.sessions.revoke_all', 'company', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], company_id, json.dumps({"revoked": revoked})),
            )
            return {"ok": True, "revoked": revoked}
