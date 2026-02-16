from fastapi import FastAPI, Depends, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.exceptions import RequestValidationError
from psycopg import errors as pg_errors
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from .routers.pos import router as pos_router
from .routers.companies import router as companies_router
from .routers.branches import router as branches_router
from .routers.warehouses import router as warehouses_router
from .routers.dimensions import router as dimensions_router
from .routers.config import router as config_router
from .routers.items import router as items_router
from .routers.item_categories import router as item_categories_router
from .routers.inventory import router as inventory_router
from .routers.sales import router as sales_router
from .routers.purchases import router as purchases_router
from .routers.supplier_credits import router as supplier_credits_router
from .routers.reports import router as reports_router
from .routers.ai import router as ai_router
from .routers.suppliers import router as suppliers_router
from .routers import party_addresses
from .routers.attachments import router as attachments_router
from .routers.customers import router as customers_router
from .routers.audit import router as audit_router
from .routers.warehouse_ops import router as warehouse_ops_router
from .routers.intercompany import router as intercompany_router
from .routers.users import router as users_router
from .routers.coa import router as coa_router
from .routers.accounting import router as accounting_router
from .routers.banking import router as banking_router
from .routers.pricing import router as pricing_router
from .routers.promotions import router as promotions_router
from .routers.telegram import router as telegram_router
from .routers.whatsapp import router as whatsapp_router
from .routers.landed_costs import router as landed_costs_router
from .routers.stock_transfers import router as stock_transfers_router
from .routers.updates import router as updates_router, sync_downloads_site_to_updates
from .routers.fx import router as fx_router
from .config import settings
from .routers.inventory_locations import router as inventory_locations_router
from .routers.inventory_warehouses_locations import router as inventory_warehouses_locations_router
from .routers.devtools import router as devtools_router
from .routers.edge_sync import router as edge_sync_router
from .routers.edge_masterdata import router as edge_masterdata_router
from .routers.edge_nodes import router as edge_nodes_router
from .routers.auth import router as auth_router
from .deps import require_company_access
from .db import get_admin_conn, close_pools

app = FastAPI(title="AH Trading ERP/POS API", version=settings.api_version)
STARTED_AT_UTC = datetime.now(timezone.utc)


def _current_request_id(req: Request) -> str:
    return getattr(req.state, "request_id", "") or req.headers.get("x-request-id") or "startup"

def _is_downloads_host(request: Request) -> bool:
    """
    Some deployments route download.melqard.com to this API container.
    We only want the "downloads landing page redirects" for that host,
    not for the main API domains.
    """
    raw_host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("x-original-host")
        or request.headers.get("host")
        or ""
    )
    host = raw_host.split(",", 1)[0].split(":", 1)[0].strip().lower()
    if not host:
        return False
    allowed = {h.strip().lower() for h in settings.download_hosts}
    return host in allowed

def _json_log(level: str, event: str, **fields):
    rec = {"ts": datetime.now(timezone.utc).isoformat(), "level": level, "event": event, **fields}
    print(json.dumps(rec, default=str), file=sys.stderr)


def _truthy(raw: str) -> bool:
    return str(raw or "").strip().lower() in {"1", "true", "yes", "on"}


def _edge_cloud_authoritative_enabled() -> bool:
    # Explicit override wins.
    if (os.getenv("EDGE_CLOUD_AUTHORITATIVE") or "").strip():
        return _truthy(os.getenv("EDGE_CLOUD_AUTHORITATIVE", ""))
    # Backward-compatible default: if this node is configured to sync with cloud, treat cloud as authoritative.
    # Guardrail: if role is explicitly declared cloud, never apply edge read-only mode implicitly.
    role = (os.getenv("APP_ROLE") or os.getenv("NODE_ROLE") or "").strip().lower()
    if role in {"cloud", "cloud-api"}:
        return False
    return bool((os.getenv("EDGE_SYNC_TARGET_URL") or "").strip())


def _edge_write_allowed_path(path: str) -> bool:
    p = str(path or "")
    if p == "/health":
        return True
    allowed_prefixes = (
        "/auth/",
        "/pos/",
        "/edge-sync/",
    )
    return any(p.startswith(x) for x in allowed_prefixes)

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


@app.exception_handler(RequestValidationError)
def _request_validation_error(_req: Request, exc: Exception):
    content = {"detail": "validation failed"}
    if settings.env in {"local", "dev"} and hasattr(exc, "errors"):
        content["errors"] = exc.errors()
    return JSONResponse(status_code=422, content=content)


@app.exception_handler(Exception)
def _unhandled_exception(req: Request, exc: Exception):
    rid = _current_request_id(req)
    _json_log(
        "error",
        "http.request.unhandled",
        request_id=rid,
        method=req.method,
        path=req.url.path,
        error=str(exc),
    )
    content = {"detail": "internal error", "request_id": rid}
    if settings.env in {"local", "dev"}:
        content["error"] = str(exc)
    return JSONResponse(status_code=500, content=content)

# Correlation id + basic structured request logging.
@app.middleware("http")
async def _request_logging(request: Request, call_next):
    rid = (request.headers.get("X-Request-Id") or "").strip() or uuid.uuid4().hex
    request.state.request_id = rid
    started = time.time()
    path = request.url.path
    method = request.method
    client_ip = (request.client.host if request.client else None)

    if _edge_cloud_authoritative_enabled() and method in {"POST", "PUT", "PATCH", "DELETE"}:
        if not _edge_write_allowed_path(path):
            return JSONResponse(
                status_code=409,
                content={
                    "detail": "cloud_authoritative_edge_read_only",
                    "hint": "This edge node is read-only for admin/master-data writes. Apply this change on cloud; edge accepts POS operations and sync only.",
                },
            )

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
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
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
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(pos_router)
app.include_router(auth_router)
app.include_router(companies_router)
app.include_router(branches_router, dependencies=[Depends(require_company_access)])
app.include_router(warehouses_router, dependencies=[Depends(require_company_access)])
app.include_router(dimensions_router, dependencies=[Depends(require_company_access)])
app.include_router(config_router, dependencies=[Depends(require_company_access)])
app.include_router(items_router, dependencies=[Depends(require_company_access)])
app.include_router(item_categories_router, dependencies=[Depends(require_company_access)])
app.include_router(inventory_router, dependencies=[Depends(require_company_access)])
app.include_router(sales_router, dependencies=[Depends(require_company_access)])
app.include_router(purchases_router, dependencies=[Depends(require_company_access)])
app.include_router(supplier_credits_router, dependencies=[Depends(require_company_access)])
app.include_router(reports_router, dependencies=[Depends(require_company_access)])
app.include_router(ai_router, dependencies=[Depends(require_company_access)])
app.include_router(suppliers_router, dependencies=[Depends(require_company_access)])
app.include_router(customers_router, dependencies=[Depends(require_company_access)])
app.include_router(party_addresses.router, dependencies=[Depends(require_company_access)])
app.include_router(attachments_router, dependencies=[Depends(require_company_access)])
app.include_router(audit_router, dependencies=[Depends(require_company_access)])
app.include_router(warehouse_ops_router, dependencies=[Depends(require_company_access)])
app.include_router(intercompany_router, dependencies=[Depends(require_company_access)])
app.include_router(users_router, dependencies=[Depends(require_company_access)])
app.include_router(coa_router, dependencies=[Depends(require_company_access)])
app.include_router(accounting_router, dependencies=[Depends(require_company_access)])
app.include_router(banking_router, dependencies=[Depends(require_company_access)])
app.include_router(pricing_router, dependencies=[Depends(require_company_access)])
app.include_router(promotions_router, dependencies=[Depends(require_company_access)])
app.include_router(fx_router, dependencies=[Depends(require_company_access)])
app.include_router(telegram_router)
app.include_router(whatsapp_router)
app.include_router(updates_router)
app.include_router(edge_sync_router)
app.include_router(edge_masterdata_router)
app.include_router(edge_nodes_router, dependencies=[Depends(require_company_access)])
app.include_router(landed_costs_router, dependencies=[Depends(require_company_access)])
app.include_router(stock_transfers_router, dependencies=[Depends(require_company_access)])
app.include_router(inventory_locations_router, dependencies=[Depends(require_company_access)])
app.include_router(inventory_warehouses_locations_router, dependencies=[Depends(require_company_access)])
# Dev-only helpers (route handlers self-disable outside local/dev).
app.include_router(devtools_router, dependencies=[Depends(require_company_access)])

@app.on_event("startup")
def _startup():
    # Keep download.melqard.com landing page in sync via the shared /updates volume.
    sync_downloads_site_to_updates()
    try:
        with get_admin_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                cur.fetchone()
        _json_log("info", "startup.db_connected", env=settings.env, version=settings.api_version)
    except Exception as exc:
        _json_log("warning", "startup.db_probe_failed", env=settings.env, error=str(exc))

@app.on_event("shutdown")
def _shutdown():
    close_pools()

@app.get("/")
def downloads_root_redirect(request: Request):
    # When routed via download.melqard.com, keep the landing page fully static.
    if _is_downloads_host(request):
        return RedirectResponse(url="/updates/site/index.html", status_code=307)
    return {"status": "ok", "service": "api"}

@app.get("/style.css")
def downloads_style_redirect(request: Request):
    if _is_downloads_host(request):
        return RedirectResponse(url="/updates/site/style.css", status_code=307)
    raise HTTPException(status_code=404, detail="not found")

@app.get("/favicon.ico")
def downloads_favicon_redirect(request: Request):
    if _is_downloads_host(request):
        return RedirectResponse(url="/updates/site/favicon.ico", status_code=307)
    raise HTTPException(status_code=404, detail="not found")

@app.get("/apple-touch-icon.png")
def downloads_apple_icon_redirect(request: Request):
    if _is_downloads_host(request):
        return RedirectResponse(url="/updates/site/apple-touch-icon.png", status_code=307)
    raise HTTPException(status_code=404, detail="not found")

@app.get("/icon-192.png")
def downloads_icon_192_redirect(request: Request):
    if _is_downloads_host(request):
        return RedirectResponse(url="/updates/site/icon-192.png", status_code=307)
    raise HTTPException(status_code=404, detail="not found")

@app.get("/icon-512.png")
def downloads_icon_512_redirect(request: Request):
    if _is_downloads_host(request):
        return RedirectResponse(url="/updates/site/icon-512.png", status_code=307)
    raise HTTPException(status_code=404, detail="not found")


def _db_health():
    try:
        with get_admin_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                cur.fetchone()
        return True, None
    except Exception as exc:
        return False, str(exc)


@app.get("/health")
def health(req: Request):
    request_id = _current_request_id(req)
    ok, err = _db_health()
    if not ok:
        content = {
            "status": "degraded",
            "env": settings.env,
            "db": "down",
            "service": "ahtrading-backend",
            "version": settings.api_version,
            "started_at": STARTED_AT_UTC.isoformat(),
            "request_id": request_id,
        }
        if settings.env in {"local", "dev"}:
            content["error"] = err
        return JSONResponse(status_code=503, content=content)
    return {
        "status": "ok",
        "env": settings.env,
        "db": "ok",
        "service": "ahtrading-backend",
        "version": settings.api_version,
        "started_at": STARTED_AT_UTC.isoformat(),
        "request_id": request_id,
    }


@app.get("/health/live")
def health_live(req: Request):
    return {
        "status": "ok",
        "env": settings.env,
        "service": "ahtrading-backend",
        "request_id": _current_request_id(req),
    }


@app.get("/health/ready")
def health_ready(req: Request):
    request_id = _current_request_id(req)
    ok, err = _db_health()
    if not ok:
        content = {
            "status": "degraded",
            "env": settings.env,
            "db": "down",
            "service": "ahtrading-backend",
            "version": settings.api_version,
            "request_id": request_id,
        }
        if settings.env in {"local", "dev"}:
            content["error"] = err
        return JSONResponse(status_code=503, content=content)
    return {
        "status": "ready",
        "env": settings.env,
        "db": "ok",
        "service": "ahtrading-backend",
        "version": settings.api_version,
        "request_id": request_id,
    }


@app.get("/meta")
def meta():
    return {
        "service": "ahtrading-backend",
        "version": settings.api_version,
        "env": settings.env,
        "uptime_seconds": int((datetime.now(timezone.utc) - STARTED_AT_UTC).total_seconds()),
        "started_at": STARTED_AT_UTC.isoformat(),
    }
