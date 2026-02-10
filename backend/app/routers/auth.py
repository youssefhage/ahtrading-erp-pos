from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
from typing import Optional
import uuid
import secrets
from psycopg import errors as pg_errors
from ..config import settings
from ..db import get_admin_conn, get_conn, set_company_context
from ..deps import get_session, SESSION_COOKIE_NAME
from ..security import hash_password, verify_password, needs_rehash, hash_session_token

router = APIRouter(prefix="/auth", tags=["auth"])
SESSION_DAYS = 7
MFA_CHALLENGE_MINUTES = 10


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(data: LoginIn):
    # Use the admin connection for auth because we need to query memberships across companies.
    with get_admin_conn() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    SELECT id, email, hashed_password, is_active, mfa_enabled, mfa_secret_enc
                    FROM users
                    WHERE email = %s
                    """,
                    (data.email,),
                )
                user = cur.fetchone()
            except pg_errors.UndefinedColumn:
                # Backwards-compatible fallback if DB migrations haven't been applied yet.
                cur.execute(
                    """
                    SELECT id, email, hashed_password, is_active
                    FROM users
                    WHERE email = %s
                    """,
                    (data.email,),
                )
                user = cur.fetchone()
                if user:
                    user["mfa_enabled"] = False
                    user["mfa_secret_enc"] = None
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

            if bool(user.get("mfa_enabled")):
                # Create a short-lived MFA challenge instead of a session.
                if not user.get("mfa_secret_enc"):
                    raise HTTPException(status_code=500, detail="MFA is enabled but no secret is configured for this user")
                mfa_token = secrets.token_urlsafe(32)
                mfa_expires = datetime.now(timezone.utc) + timedelta(minutes=MFA_CHALLENGE_MINUTES)
                cur.execute(
                    """
                    INSERT INTO auth_mfa_challenges (id, user_id, token_hash, expires_at)
                    VALUES (gen_random_uuid(), %s, %s, %s)
                    """,
                    (user["id"], hash_session_token(mfa_token), mfa_expires),
                )
                return {
                    "mfa_required": True,
                    "mfa_token": mfa_token,
                    "user_id": str(user["id"]),
                    "companies": [str(c) for c in companies],
                    "active_company_id": str(active_company_id) if active_company_id else None,
                }

            # Use a strong random token and store only a one-way hash in the DB.
            token = secrets.token_urlsafe(32)
            expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
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


class MfaVerifyIn(BaseModel):
    mfa_token: str
    code: str


@router.post("/mfa/verify")
def mfa_verify(data: MfaVerifyIn):
    """
    Complete MFA login: validate a short-lived MFA token + TOTP code, then mint a normal session.
    """
    from ..mfa import decrypt_secret, verify_totp_code

    token = (data.mfa_token or "").strip()
    code = (data.code or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="mfa_token is required")
    if not code:
        raise HTTPException(status_code=400, detail="code is required")

    now = datetime.now(timezone.utc)

    with get_admin_conn() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, user_id, expires_at, attempts, consumed_at
                    FROM auth_mfa_challenges
                    WHERE token_hash = %s
                    """,
                    (hash_session_token(token),),
                )
                ch = cur.fetchone()
                if not ch or ch["consumed_at"] is not None or ch["expires_at"] < now:
                    raise HTTPException(status_code=401, detail="invalid or expired MFA token")

                if int(ch.get("attempts") or 0) >= 10:
                    # Too many attempts; consume and stop.
                    cur.execute("UPDATE auth_mfa_challenges SET consumed_at = now() WHERE id = %s", (ch["id"],))
                    raise HTTPException(status_code=401, detail="too many MFA attempts")

                cur.execute(
                    """
                    SELECT id, email, is_active, mfa_enabled, mfa_secret_enc
                    FROM users
                    WHERE id = %s
                    """,
                    (ch["user_id"],),
                )
                user = cur.fetchone()
                if not user or not user["is_active"]:
                    raise HTTPException(status_code=401, detail="invalid credentials")
                if not bool(user.get("mfa_enabled")) or not user.get("mfa_secret_enc"):
                    raise HTTPException(status_code=401, detail="MFA is not enabled for this user")

                secret = decrypt_secret(user["mfa_secret_enc"])
                ok = verify_totp_code(secret, code)
                if not ok:
                    cur.execute(
                        "UPDATE auth_mfa_challenges SET attempts = attempts + 1 WHERE id = %s",
                        (ch["id"],),
                    )
                    raise HTTPException(status_code=401, detail="invalid MFA code")

                # Consume challenge and mint session.
                cur.execute("UPDATE auth_mfa_challenges SET consumed_at = now() WHERE id = %s", (ch["id"],))

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

                session_token = secrets.token_urlsafe(32)
                expires = now + timedelta(days=SESSION_DAYS)
                cur.execute(
                    """
                    INSERT INTO auth_sessions (id, user_id, token, expires_at, active_company_id)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s)
                    """,
                    (user["id"], hash_session_token(session_token), expires, active_company_id),
                )

                resp = JSONResponse(
                    {
                        "token": session_token,
                        "user_id": str(user["id"]),
                        "companies": [str(c) for c in companies],
                        "active_company_id": str(active_company_id) if active_company_id else None,
                    }
                )
                secure = settings.env not in {"local", "dev"}
                resp.set_cookie(
                    key=SESSION_COOKIE_NAME,
                    value=session_token,
                    httponly=True,
                    samesite="lax",
                    secure=secure,
                    max_age=SESSION_DAYS * 24 * 60 * 60,
                    path="/",
                )
                return resp


@router.get("/mfa/status")
def mfa_status(session=Depends(get_session)):
    with get_admin_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT mfa_enabled,
                       (mfa_pending_secret_enc IS NOT NULL) AS pending
                FROM users
                WHERE id = %s
                """,
                (session["user_id"],),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="user not found")
            return {"enabled": bool(row["mfa_enabled"]), "pending": bool(row["pending"])}


@router.post("/mfa/setup")
def mfa_setup(session=Depends(get_session)):
    """
    Begin MFA enrollment for the current user.
    Returns a new secret + otpauth URL and stores it as "pending" until verified.
    """
    from ..mfa import new_totp_secret, provisioning_uri, encrypt_secret

    with get_admin_conn() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT email, mfa_enabled FROM users WHERE id = %s",
                    (session["user_id"],),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="user not found")
                if bool(row.get("mfa_enabled")):
                    raise HTTPException(status_code=409, detail="MFA is already enabled")

                secret = new_totp_secret()
                enc = encrypt_secret(secret)
                cur.execute(
                    """
                    UPDATE users
                    SET mfa_pending_secret_enc = %s
                    WHERE id = %s
                    """,
                    (enc, session["user_id"]),
                )
                return {
                    "secret": secret,
                    "otpauth_url": provisioning_uri(secret, row["email"]),
                }


class MfaEnableIn(BaseModel):
    code: str


@router.post("/mfa/enable")
def mfa_enable(data: MfaEnableIn, session=Depends(get_session)):
    """
    Verify the pending secret and enable MFA.
    """
    from ..mfa import decrypt_secret, verify_totp_code

    code = (data.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")

    with get_admin_conn() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT mfa_enabled, mfa_pending_secret_enc
                    FROM users
                    WHERE id = %s
                    """,
                    (session["user_id"],),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="user not found")
                if bool(row.get("mfa_enabled")):
                    raise HTTPException(status_code=409, detail="MFA is already enabled")
                if not row.get("mfa_pending_secret_enc"):
                    raise HTTPException(status_code=409, detail="No pending MFA setup. Call /auth/mfa/setup first.")

                secret = decrypt_secret(row["mfa_pending_secret_enc"])
                if not verify_totp_code(secret, code):
                    raise HTTPException(status_code=401, detail="invalid MFA code")

                cur.execute(
                    """
                    UPDATE users
                    SET mfa_enabled = true,
                        mfa_secret_enc = mfa_pending_secret_enc,
                        mfa_pending_secret_enc = NULL,
                        mfa_verified_at = now()
                    WHERE id = %s
                    """,
                    (session["user_id"],),
                )
                # Enabling MFA is a sensitive change: revoke all sessions except current.
                cur.execute(
                    """
                    UPDATE auth_sessions
                    SET is_active = false
                    WHERE user_id = %s AND id <> %s
                    """,
                    (session["user_id"], session["session_id"]),
                )
                return {"ok": True}


class MfaDisableIn(BaseModel):
    code: str


@router.post("/mfa/disable")
def mfa_disable(data: MfaDisableIn, session=Depends(get_session)):
    """
    Disable MFA for the current user (requires a valid current TOTP code).
    """
    from ..mfa import decrypt_secret, verify_totp_code

    code = (data.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")

    with get_admin_conn() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT mfa_enabled, mfa_secret_enc
                    FROM users
                    WHERE id = %s
                    """,
                    (session["user_id"],),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="user not found")
                if not bool(row.get("mfa_enabled")) or not row.get("mfa_secret_enc"):
                    raise HTTPException(status_code=409, detail="MFA is not enabled")

                secret = decrypt_secret(row["mfa_secret_enc"])
                if not verify_totp_code(secret, code):
                    raise HTTPException(status_code=401, detail="invalid MFA code")

                cur.execute(
                    """
                    UPDATE users
                    SET mfa_enabled = false,
                        mfa_secret_enc = NULL,
                        mfa_pending_secret_enc = NULL,
                        mfa_verified_at = NULL
                    WHERE id = %s
                    """,
                    (session["user_id"],),
                )
                # Disabling MFA is also sensitive: revoke other sessions.
                cur.execute(
                    """
                    UPDATE auth_sessions
                    SET is_active = false
                    WHERE user_id = %s AND id <> %s
                    """,
                    (session["user_id"], session["session_id"]),
                )
                return {"ok": True}


@router.get("/me")
def me(session=Depends(get_session)):
    with get_admin_conn() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    SELECT full_name, phone, mfa_enabled
                    FROM users
                    WHERE id = %s
                    """,
                    (session["user_id"],),
                )
                u = cur.fetchone() or {}
            except pg_errors.UndefinedColumn:
                u = {}

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
        "full_name": u.get("full_name"),
        "phone": u.get("phone"),
        "mfa_enabled": bool(u.get("mfa_enabled")),
        "active_company_id": str(session.get("active_company_id")) if session.get("active_company_id") else None,
        "companies": companies,
    }


class ProfileUpdateIn(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None


@router.patch("/profile")
def update_profile(data: ProfileUpdateIn, session=Depends(get_session)):
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
    params.append(session["user_id"])

    with get_admin_conn() as conn:
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
