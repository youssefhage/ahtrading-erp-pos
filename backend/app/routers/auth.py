from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
import uuid
import secrets
from ..config import settings
from ..db import get_admin_conn, get_conn, set_company_context
from ..deps import get_session, SESSION_COOKIE_NAME
from ..security import hash_password, verify_password, needs_rehash, hash_session_token

router = APIRouter(prefix="/auth", tags=["auth"])
SESSION_DAYS = 7


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(data: LoginIn):
    # Use the admin connection for auth because we need to query memberships across companies.
    with get_admin_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, email, hashed_password, is_active
                FROM users
                WHERE email = %s
                """,
                (data.email,),
            )
            user = cur.fetchone()
            if not user or not user["is_active"]:
                raise HTTPException(status_code=401, detail="invalid credentials")
            if not verify_password(data.password, user["hashed_password"]):
                raise HTTPException(status_code=401, detail="invalid credentials")

            if needs_rehash(user["hashed_password"]):
                cur.execute(
                    """
                    UPDATE users
                    SET hashed_password = %s
                    WHERE id = %s
                    """,
                    (hash_password(data.password), user["id"]),
                )

            # Use a strong random token and store only a one-way hash in the DB.
            token = secrets.token_urlsafe(32)
            expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
            cur.execute(
                """
                SELECT DISTINCT company_id
                FROM user_roles
                WHERE user_id = %s
                ORDER BY company_id
                """,
                (user["id"],),
            )
            companies = [r["company_id"] for r in cur.fetchall()]
            active_company_id = companies[0] if companies else None

            cur.execute(
                """
                INSERT INTO auth_sessions (id, user_id, token, expires_at, active_company_id)
                VALUES (gen_random_uuid(), %s, %s, %s, %s)
                """,
                (user["id"], hash_session_token(token), expires, active_company_id),
            )

            resp = JSONResponse(
                {
                    # Keep returning the token for backwards compatibility (legacy admin/POS tools).
                    "token": token,
                    "user_id": str(user["id"]),
                    "companies": [str(c) for c in companies],
                    "active_company_id": str(active_company_id) if active_company_id else None,
                }
            )
            secure = settings.env not in {"local", "dev"}
            resp.set_cookie(
                key=SESSION_COOKIE_NAME,
                value=token,
                httponly=True,
                samesite="lax",
                secure=secure,
                max_age=SESSION_DAYS * 24 * 60 * 60,
                path="/",
            )
            return resp


@router.get("/me")
def me(session=Depends(get_session)):
    with get_admin_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT company_id
                FROM user_roles
                WHERE user_id = %s
                ORDER BY company_id
                """,
                (session["user_id"],),
            )
            companies = [str(r["company_id"]) for r in cur.fetchall()]
    return {
        "user_id": session["user_id"],
        "email": session["email"],
        "active_company_id": str(session.get("active_company_id")) if session.get("active_company_id") else None,
        "companies": companies,
    }


@router.post("/logout")
def logout(session=Depends(get_session)):
    token = session["token"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE auth_sessions
                SET is_active = false
                WHERE token = %s OR (token = %s AND token NOT LIKE 'sha256:%')
                """,
                (hash_session_token(token), token),
            )
            resp = JSONResponse({"ok": True})
            resp.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
            return resp


@router.post("/logout-all")
def logout_all(session=Depends(get_session)):
    """
    Revoke all sessions for the current user (useful after password resets or when a token may be leaked).
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE auth_sessions
                SET is_active = false
                WHERE user_id = %s
                """,
                (session["user_id"],),
            )
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return resp


class SelectCompanyIn(BaseModel):
    company_id: uuid.UUID


@router.post("/select-company")
def select_company(data: SelectCompanyIn, session=Depends(get_session)):
    # Verify the user has access in the target company, then persist it on the session
    # so clients don't need to send X-Company-Id on every request.
    with get_conn() as conn:
        with conn.transaction():
            set_company_context(conn, str(data.company_id))
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT 1
                    FROM user_roles
                    WHERE user_id = %s AND company_id = %s
                    LIMIT 1
                    """,
                    (session["user_id"], str(data.company_id)),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=403, detail="no company access")

                cur.execute(
                    """
                    UPDATE auth_sessions
                    SET active_company_id = %s
                    WHERE id = %s
                    """,
                    (str(data.company_id), session["session_id"]),
                )

    return {"ok": True, "active_company_id": str(data.company_id)}
