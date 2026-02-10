import os
from psycopg.rows import dict_row
from contextlib import contextmanager

# psycopg3 connection pooling lives in a separate package.
from psycopg_pool import ConnectionPool

DATABASE_URL_ADMIN = os.getenv("DATABASE_URL_ADMIN") or os.getenv("DATABASE_URL") or "postgresql://localhost/ahtrading"
DATABASE_URL = os.getenv("APP_DATABASE_URL") or os.getenv("DATABASE_URL") or "postgresql://localhost/ahtrading"

def _env_int(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except Exception:
        return default

# Pool sizing defaults are conservative for local/dev. Override in prod via env:
# - DB_POOL_MIN_SIZE / DB_POOL_MAX_SIZE
# - DB_ADMIN_POOL_MIN_SIZE / DB_ADMIN_POOL_MAX_SIZE
_POOL_MIN = _env_int("DB_POOL_MIN_SIZE", 1)
_POOL_MAX = _env_int("DB_POOL_MAX_SIZE", 10)
_ADMIN_POOL_MIN = _env_int("DB_ADMIN_POOL_MIN_SIZE", 1)
_ADMIN_POOL_MAX = _env_int("DB_ADMIN_POOL_MAX_SIZE", 5)

# Global pools (one for app role, one for admin/super role).
# Note: we keep row_factory=dict_row to preserve existing handler expectations.
_pool = ConnectionPool(
    conninfo=DATABASE_URL,
    min_size=_POOL_MIN,
    max_size=_POOL_MAX,
    kwargs={"row_factory": dict_row},
)

_admin_pool = ConnectionPool(
    conninfo=DATABASE_URL_ADMIN,
    min_size=_ADMIN_POOL_MIN,
    max_size=_ADMIN_POOL_MAX,
    kwargs={"row_factory": dict_row},
)

@contextmanager
def _pooled_conn(pool: ConnectionPool):
    # Preserve existing semantics of `with get_conn() as conn:`:
    # - commit on success
    # - rollback on exception
    # - return connection to pool
    with pool.connection() as conn:
        with conn:
            yield conn


def get_conn():
    return _pooled_conn(_pool)

def get_admin_conn():
    return _pooled_conn(_admin_pool)


def close_pools() -> None:
    # Best-effort shutdown hook (e.g. uvicorn shutdown).
    try:
        _pool.close()
    except Exception:
        pass
    try:
        _admin_pool.close()
    except Exception:
        pass


def set_company_context(conn, company_id: str):
    with conn.cursor() as cur:
        # `SET ... = %s` is not valid when using the extended query protocol (psycopg sends $1).
        # Use set_config() to safely parameterize the value.
        # set_config(name text, value text, is_local boolean)
        cur.execute(
            "SELECT set_config('app.current_company_id', %s::text, true)",
            (company_id,),
        )
