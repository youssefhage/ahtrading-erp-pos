from fastapi import Header, HTTPException, Depends, Cookie
from .db import get_conn, get_admin_conn, set_company_context
from .security import verify_device_token
from datetime import datetime, timezone
from typing import Optional
import uuid


SESSION_COOKIE_NAME = "ahtrading_session"


def _extract_session_token(authorization: Optional[str], cookie_token: Optional[str]) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1]
    if cookie_token:
        return cookie_token
    raise HTTPException(status_code=401, detail="missing token")


def get_session(
    authorization: Optional[str] = Header(None),
    cookie_token: Optional[str] = Cookie(None, alias=SESSION_COOKIE_NAME),
):
    token = _extract_session_token(authorization, cookie_token)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id AS session_id, s.user_id, u.email, s.expires_at, s.is_active, s.active_company_id
                FROM auth_sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token = %s
                """,
                (token,),
            )
            row = cur.fetchone()
            now = datetime.now(timezone.utc)
            if not row or not row["is_active"] or row["expires_at"] < now:
                raise HTTPException(status_code=401, detail="invalid token")
            return {
                "session_id": row["session_id"],
                "user_id": row["user_id"],
                "email": row["email"],
                "active_company_id": row["active_company_id"],
                "token": token,
            }


def get_current_user(session=Depends(get_session)):
    return {"user_id": session["user_id"], "email": session["email"]}


def get_company_id(
    x_company_id: Optional[str] = Header(None, alias="X-Company-Id"),
    session=Depends(get_session),
) -> str:
    if x_company_id:
        return x_company_id
    if session.get("active_company_id"):
        return str(session["active_company_id"])
    raise HTTPException(status_code=400, detail="missing company id")


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
    # Devices don't know their company_id a priori. Use the admin connection to look
    # up the device by id, then return its company_id so handlers can set context.
    with get_admin_conn() as conn:
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
