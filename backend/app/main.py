from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg import errors as pg_errors
import json
import sys
import time
import uuid
from datetime import datetime
from .routers.pos import router as pos_router
from .routers.companies import router as companies_router
from .routers.branches import router as branches_router
from .routers.warehouses import router as warehouses_router
from .routers.config import router as config_router
from .routers.items import router as items_router
from .routers.item_categories import router as item_categories_router
from .routers.inventory import router as inventory_router
from .routers.sales import router as sales_router
from .routers.purchases import router as purchases_router
from .routers.reports import router as reports_router
from .routers.ai import router as ai_router
from .routers.suppliers import router as suppliers_router
from .routers import party_addresses
from .routers.attachments import router as attachments_router
from .routers.customers import router as customers_router
from .routers.intercompany import router as intercompany_router
from .routers.users import router as users_router
from .routers.coa import router as coa_router
from .routers.accounting import router as accounting_router
from .routers.banking import router as banking_router
from .routers.pricing import router as pricing_router
from .routers.promotions import router as promotions_router
from .routers.telegram import router as telegram_router
from .routers.devtools import router as devtools_router
from .routers.auth import router as auth_router
from .config import settings
from .deps import require_company_access
from .db import get_admin_conn

app = FastAPI(title="AH Trading ERP/POS API", version="0.1.0")

def _json_log(level: str, event: str, **fields):
    rec = {"ts": datetime.utcnow().isoformat(), "level": level, "event": event, **fields}
    print(json.dumps(rec, default=str), file=sys.stderr)

# Map common DB constraint/cast errors to 4xx so clients get actionable responses
# instead of generic 500s.
@app.exception_handler(pg_errors.InvalidTextRepresentation)
def _invalid_text_representation(_req: Request, exc: Exception):
    # e.g. invalid enum cast: 'usd'::currency_code
    content = {"detail": "invalid value"}
    if settings.env in {"local", "dev"}:
        content["error"] = str(exc)
    return JSONResponse(status_code=400, content=content)


@app.exception_handler(pg_errors.ForeignKeyViolation)
def _foreign_key_violation(_req: Request, exc: Exception):
    content = {"detail": "invalid reference"}
    if settings.env in {"local", "dev"}:
        content["error"] = str(exc)
    return JSONResponse(status_code=400, content=content)


@app.exception_handler(pg_errors.UniqueViolation)
def _unique_violation(_req: Request, exc: Exception):
    content = {"detail": "conflict"}
    if settings.env in {"local", "dev"}:
        content["error"] = str(exc)
    return JSONResponse(status_code=409, content=content)


@app.exception_handler(pg_errors.CheckViolation)
def _check_violation(_req: Request, exc: Exception):
    content = {"detail": "constraint violation"}
    if settings.env in {"local", "dev"}:
        content["error"] = str(exc)
    return JSONResponse(status_code=400, content=content)

# Correlation id + basic structured request logging.
@app.middleware("http")
async def _request_logging(request: Request, call_next):
    rid = (request.headers.get("X-Request-Id") or "").strip() or uuid.uuid4().hex
    request.state.request_id = rid
    started = time.time()
    path = request.url.path
    method = request.method
    client_ip = (request.client.host if request.client else None)

    try:
        response = await call_next(request)
    except Exception as exc:
        dur_ms = int((time.time() - started) * 1000)
        _json_log(
            "error",
            "http.request.error",
            request_id=rid,
            method=method,
            path=path,
            client_ip=client_ip,
            duration_ms=dur_ms,
            error=str(exc),
        )
        raise

    response.headers["X-Request-Id"] = rid
    if path != "/health":
        dur_ms = int((time.time() - started) * 1000)
        _json_log(
            "info",
            "http.request",
            request_id=rid,
            method=method,
            path=path,
            status_code=response.status_code,
            client_ip=client_ip,
            duration_ms=dur_ms,
        )
    return response

# Dev CORS: Admin app runs on a different port during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(pos_router)
app.include_router(auth_router)
app.include_router(companies_router)
app.include_router(branches_router, dependencies=[Depends(require_company_access)])
app.include_router(warehouses_router, dependencies=[Depends(require_company_access)])
app.include_router(config_router, dependencies=[Depends(require_company_access)])
app.include_router(items_router, dependencies=[Depends(require_company_access)])
app.include_router(item_categories_router, dependencies=[Depends(require_company_access)])
app.include_router(inventory_router, dependencies=[Depends(require_company_access)])
app.include_router(sales_router, dependencies=[Depends(require_company_access)])
app.include_router(purchases_router, dependencies=[Depends(require_company_access)])
app.include_router(reports_router, dependencies=[Depends(require_company_access)])
app.include_router(ai_router, dependencies=[Depends(require_company_access)])
app.include_router(suppliers_router, dependencies=[Depends(require_company_access)])
app.include_router(customers_router, dependencies=[Depends(require_company_access)])
app.include_router(party_addresses.router, dependencies=[Depends(require_company_access)])
app.include_router(attachments_router, dependencies=[Depends(require_company_access)])
app.include_router(intercompany_router, dependencies=[Depends(require_company_access)])
app.include_router(users_router, dependencies=[Depends(require_company_access)])
app.include_router(coa_router, dependencies=[Depends(require_company_access)])
app.include_router(accounting_router, dependencies=[Depends(require_company_access)])
app.include_router(banking_router, dependencies=[Depends(require_company_access)])
app.include_router(pricing_router, dependencies=[Depends(require_company_access)])
app.include_router(promotions_router, dependencies=[Depends(require_company_access)])
app.include_router(telegram_router)
# Dev-only helpers (route handlers self-disable outside local/dev).
app.include_router(devtools_router, dependencies=[Depends(require_company_access)])

@app.get("/health")
def health():
    try:
        with get_admin_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                cur.fetchone()
        return {
            "status": "ok",
            "env": settings.env,
            "db": "ok",
        }
    except Exception as exc:
        content = {"status": "degraded", "env": settings.env, "db": "down"}
        if settings.env in {"local", "dev"}:
            content["error"] = str(exc)
        return JSONResponse(status_code=503, content=content)

@app.get("/meta")
def meta():
    return {
        "service": "ahtrading-backend",
        "version": app.version,
    }
