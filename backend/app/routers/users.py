from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission
from ..security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


class UserIn(BaseModel):
    email: str
    password: str


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
                SELECT DISTINCT u.id, u.email, u.is_active
                FROM users u
                JOIN user_roles ur ON ur.user_id = u.id
                WHERE ur.company_id = %s
                ORDER BY u.email
                """,
                (company_id,),
            )
            return {"users": cur.fetchall()}


@router.post("", dependencies=[Depends(require_permission("users:write"))])
def create_user(data: UserIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (id, email, hashed_password)
                VALUES (gen_random_uuid(), %s, %s)
                RETURNING id
                """,
                (data.email, hash_password(data.password)),
            )
            return {"id": cur.fetchone()["id"]}


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
def create_role(data: RoleIn, company_id: str = Depends(get_company_id)):
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
            return {"id": cur.fetchone()["id"]}


@router.post("/roles/assign", dependencies=[Depends(require_permission("users:write"))])
def assign_role(data: RoleAssignIn, company_id: str = Depends(get_company_id)):
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
def assign_role_permission(data: RolePermissionIn, company_id: str = Depends(get_company_id)):
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
            return {"ok": True}


@router.post("/{user_id}/sessions/revoke", dependencies=[Depends(require_permission("users:write"))])
def revoke_user_sessions(user_id: str, company_id: str = Depends(get_company_id)):
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
            return {"ok": True, "revoked": cur.rowcount}
