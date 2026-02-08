#!/usr/bin/env python3
import argparse
import os
import sys

import psycopg
from psycopg.rows import dict_row

from backend.app.security import hash_password


def main() -> int:
    parser = argparse.ArgumentParser(description="Reset a user's password (admin/maintenance).")
    parser.add_argument(
        "--db",
        default=os.getenv("DATABASE_URL") or "postgresql://localhost/ahtrading",
        help="Postgres connection string (defaults to $DATABASE_URL).",
    )
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    email = (args.email or "").strip().lower()
    if not email:
        print("email is required", file=sys.stderr)
        return 2

    with psycopg.connect(args.db, row_factory=dict_row) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE users
                    SET hashed_password = %s,
                        is_active = true
                    WHERE email = %s
                    RETURNING id
                    """,
                    (hash_password(args.password), email),
                )
                row = cur.fetchone()
                if not row:
                    print(f"user not found: {email}", file=sys.stderr)
                    return 2
                user_id = row["id"]

                # Security: revoke any existing sessions so old tokens/cookies can't be reused
                # after a password reset.
                cur.execute(
                    """
                    UPDATE auth_sessions
                    SET is_active = false
                    WHERE user_id = %s
                    """,
                    (user_id,),
                )

    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
