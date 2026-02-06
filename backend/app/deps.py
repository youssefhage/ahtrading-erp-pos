from fastapi import Header, HTTPException, Depends
from .db import get_conn, set_company_context
from .security import verify_device_token
from datetime import datetime
import uuid


def get_company_id(x_company_id: str = Header(..., alias="X-Company-Id")) -> str:
    return x_company_id


def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing token")
    token = authorization.split(" ", 1)[1]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.user_id, u.email, s.expires_at, s.is_active
                FROM auth_sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token = %s
                """,
                (token,),
            )
            row = cur.fetchone()
            if not row or not row["is_active"] or row["expires_at"] < datetime.utcnow():
                raise HTTPException(status_code=401, detail="invalid token")
            return {"user_id": row["user_id"], "email": row["email"]}


def require_company_access(company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
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
    return True


def require_permission(code: str):
    def _dep(company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
        with get_conn() as conn:
            set_company_context(conn, company_id)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT 1
                    FROM user_roles ur
                    JOIN role_permissions rp ON rp.role_id = ur.role_id
                    JOIN permissions p ON p.id = rp.permission_id
                    WHERE ur.user_id = %s AND ur.company_id = %s AND p.code = %s
                    LIMIT 1
                    """,
                    (user["user_id"], company_id, code),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=403, detail="permission denied")
        return True
    return _dep


def require_device(
    device_id: uuid.UUID = Header(..., alias="X-Device-Id"),
    device_token: str = Header(..., alias="X-Device-Token"),
):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT company_id, device_token_hash
                FROM pos_devices
                WHERE id = %s
                """,
                (device_id,),
            )
            row = cur.fetchone()
            if not row or not verify_device_token(device_token, row["device_token_hash"]):
                raise HTTPException(status_code=401, detail="invalid device token")
            return {"device_id": device_id, "company_id": row["company_id"]}
