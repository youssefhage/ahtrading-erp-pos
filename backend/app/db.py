import os
import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://localhost/ahtrading')


def get_conn():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def set_company_context(conn, company_id: str):
    with conn.cursor() as cur:
        cur.execute("SET app.current_company_id = %s", (company_id,))
