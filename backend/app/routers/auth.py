from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from datetime import datetime, timedelta
import uuid
from ..db import get_conn
from ..security import hash_password, verify_password, needs_rehash

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(data: LoginIn):
    with get_conn() as conn:
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

            token = str(uuid.uuid4())
            expires = datetime.utcnow() + timedelta(days=7)
            cur.execute(
                """
                INSERT INTO auth_sessions (id, user_id, token, expires_at)
                VALUES (gen_random_uuid(), %s, %s, %s)
                """,
                (user["id"], token, expires),
            )

            cur.execute(
                """
                SELECT DISTINCT company_id
                FROM user_roles
                WHERE user_id = %s
                """,
                (user["id"],),
            )
            companies = [r["company_id"] for r in cur.fetchall()]

            return {"token": token, "user_id": user["id"], "companies": companies}


@router.get("/me")
def me(authorization: str = Header(None)):
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


@router.post("/logout")
def logout(authorization: str = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing token")
    token = authorization.split(" ", 1)[1]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE auth_sessions
                SET is_active = false
                WHERE token = %s
                """,
                (token,),
            )
            return {"ok": True}
