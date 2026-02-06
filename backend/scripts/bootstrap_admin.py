#!/usr/bin/env python3
import os
import secrets
import sys

import psycopg
from psycopg.rows import dict_row

from backend.app.security import hash_password


def _truthy(v: str) -> bool:
    return (v or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _generate_password() -> str:
    # URL-safe and copy/paste friendly.
    return secrets.token_urlsafe(16)


def main() -> int:
    if not _truthy(os.getenv("BOOTSTRAP_ADMIN", "")):
        return 0

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("bootstrap_admin: missing DATABASE_URL", file=sys.stderr)
        return 2

    email = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "admin@ahtrading.local").strip().lower()
    if not email:
        print("bootstrap_admin: BOOTSTRAP_ADMIN_EMAIL is empty", file=sys.stderr)
        return 2

    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD")
    generated_password = False
    if not password:
        password = _generate_password()
        generated_password = True

    role_name = os.getenv("BOOTSTRAP_ADMIN_ROLE_NAME", "Owner").strip() or "Owner"

    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM users WHERE email = %s", (email,))
                row = cur.fetchone()
                if row:
                    # Idempotent: don't create duplicate users.
                    return 0

                cur.execute(
                    """
                    INSERT INTO users (id, email, hashed_password, is_active)
                    VALUES (gen_random_uuid(), %s, %s, true)
                    RETURNING id
                    """,
                    (email, hash_password(password)),
                )
                user_id = cur.fetchone()["id"]

                cur.execute("SELECT id FROM companies ORDER BY created_at ASC")
                companies = cur.fetchall()
                if not companies:
                    return 0

                for c in companies:
                    company_id = c["id"]

                    cur.execute(
                        """
                        SELECT id
                        FROM roles
                        WHERE company_id = %s AND name = %s
                        ORDER BY created_at ASC
                        LIMIT 1
                        """,
                        (company_id, role_name),
                    )
                    r = cur.fetchone()
                    if r:
                        role_id = r["id"]
                    else:
                        cur.execute(
                            """
                            INSERT INTO roles (id, company_id, name)
                            VALUES (gen_random_uuid(), %s, %s)
                            RETURNING id
                            """,
                            (company_id, role_name),
                        )
                        role_id = cur.fetchone()["id"]

                    # Grant everything to the bootstrap role.
                    cur.execute(
                        """
                        INSERT INTO role_permissions (role_id, permission_id)
                        SELECT %s, p.id
                        FROM permissions p
                        ON CONFLICT DO NOTHING
                        """,
                        (role_id,),
                    )

                    cur.execute(
                        """
                        INSERT INTO user_roles (user_id, role_id, company_id)
                        VALUES (%s, %s, %s)
                        ON CONFLICT DO NOTHING
                        """,
                        (user_id, role_id, company_id),
                    )

    print("BOOTSTRAP_ADMIN_CREATED")
    print(f"email: {email}")
    if generated_password:
        print(f"password: {password}")
    else:
        print("password: (provided via BOOTSTRAP_ADMIN_PASSWORD)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

