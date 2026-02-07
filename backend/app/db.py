import os
import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://localhost/ahtrading')


def get_conn():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def set_company_context(conn, company_id: str):
    with conn.cursor() as cur:
        # `SET ... = %s` is not valid when using the extended query protocol (psycopg sends $1).
        # Use set_config() to safely parameterize the value.
        cur.execute("SELECT set_config('app.current_company_id', %s, true)", (company_id,))
