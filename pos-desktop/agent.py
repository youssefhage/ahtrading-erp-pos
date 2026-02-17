#!/usr/bin/env python3
import argparse
import html
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote, urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
import secrets
from datetime import timedelta
from typing import Optional
import time

import bcrypt

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, 'pos.sqlite')  # can be overridden via CLI/env (see main())
CONFIG_PATH = os.path.join(ROOT, 'config.json')  # can be overridden via CLI/env (see main())

# When packaged as a single binary (PyInstaller), data files are extracted under
# sys._MEIPASS. Keep runtime paths working in both dev + packaged modes.
_MEIPASS = getattr(sys, "_MEIPASS", None)
if _MEIPASS:
    UI_PATH = os.path.join(_MEIPASS, "ui")
    # Bundled directly at root of the extracted dir for simplicity.
    SCHEMA_PATH = os.path.join(_MEIPASS, "sqlite_schema.sql")
else:
    UI_PATH = os.path.join(ROOT, "ui")
    SCHEMA_PATH = os.path.join(os.path.dirname(ROOT), "pos", "sqlite_schema.sql")


def _served_ui_root():
    # Prefer a Vite build if present, while keeping old static layouts as fallback.
    dist_root = os.path.join(UI_PATH, "dist")
    if os.path.isdir(dist_root):
        return dist_root
    return UI_PATH

DEFAULT_CONFIG = {
    'api_base_url': 'http://localhost:8001',
    # Hybrid mode (Edge-first with Cloud fallback):
    # - edge_api_base_url: LAN/on-prem Edge base (preferred when reachable)
    # - cloud_api_base_url: Cloud backend base (fallback when Edge is down)
    #
    # If these are empty, the agent falls back to api_base_url behavior.
    'edge_api_base_url': '',
    'cloud_api_base_url': '',
    # Base URL of the Admin web app that serves /exports/.../pdf routes.
    # Needed for "Official -> A4 invoice PDF" kiosk printing from the POS.
    'print_base_url': '',
    'company_id': '',
    'device_id': '',
    'device_token': '',
    'warehouse_id': '',
    'shift_id': '',
    'cashier_id': '',
    'default_customer_id': '',
    'exchange_rate': 0,
    'rate_type': 'market',
    'pricing_currency': 'USD',
    'vat_rate': 0.11,
    'tax_code_id': None,
    # Optional VAT tax code map (id -> rate) pulled from backend /pos/config.
    # When present, allows item-level VAT (exempt/zero-rated/standard) in the POS.
    'vat_codes': {},
    'loyalty_rate': 0,
    # Optional local admin PIN to protect the POS agent when bound to LAN.
    # Stored as bcrypt hash string (same family as backend cashier pins).
    'admin_pin_hash': '',
    # If true, require admin PIN even for localhost requests.
    'require_admin_pin': False,
    # Session duration for admin unlock when required.
    'admin_session_hours': 12,

    # Company-level inventory policy (pulled from backend) used for POS lot prompting UX.
    # Shallow-merged; agent sync overwrites this object.
    'inventory_policy': {
        'require_manual_lot_selection': False,
    },

    # Printing (optional)
    # - When configured, the agent can print the last receipt directly via OS print spooling
    #   without opening a browser print dialog (works best in kiosk setups).
    'receipt_printer': '',
    'receipt_print_copies': 1,
    'auto_print_receipt': False,

    # Official invoice printing (A4 PDF) (optional)
    'invoice_printer': '',
    'invoice_print_copies': 1,
    'auto_print_invoice': False,
}


def load_config():
    if not os.path.exists(CONFIG_PATH):
        save_config(DEFAULT_CONFIG)
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    cfg = {**DEFAULT_CONFIG, **data}
    # Allow Docker/ops to override without rewriting the on-disk config.
    if os.environ.get("POS_API_BASE_URL"):
        cfg["api_base_url"] = os.environ["POS_API_BASE_URL"]
        # Back-compat: if hybrid URLs are not provided, seed them with POS_API_BASE_URL.
        if not (cfg.get("edge_api_base_url") or "").strip():
            cfg["edge_api_base_url"] = os.environ["POS_API_BASE_URL"]
        if not (cfg.get("cloud_api_base_url") or "").strip():
            cfg["cloud_api_base_url"] = os.environ["POS_API_BASE_URL"]
    if os.environ.get("POS_EDGE_API_BASE_URL"):
        cfg["edge_api_base_url"] = os.environ["POS_EDGE_API_BASE_URL"]
    if os.environ.get("POS_CLOUD_API_BASE_URL"):
        cfg["cloud_api_base_url"] = os.environ["POS_CLOUD_API_BASE_URL"]
    if os.environ.get("POS_COMPANY_ID"):
        cfg["company_id"] = os.environ["POS_COMPANY_ID"]
    if os.environ.get("POS_DEVICE_ID"):
        cfg["device_id"] = os.environ["POS_DEVICE_ID"]
    if os.environ.get("POS_DEVICE_TOKEN"):
        cfg["device_token"] = os.environ["POS_DEVICE_TOKEN"]
    return cfg


def save_config(data):
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)


def db_connect():
    conn = sqlite3.connect(DB_PATH)
    # Local-first POS tuning:
    # - WAL improves read/write concurrency (UI reads while outbox/sync writes).
    # - NORMAL synchronous keeps durability practical but faster than FULL.
    # - Busy timeout prevents transient "database is locked" spikes during heavy shifts.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _is_loopback(ip: str) -> bool:
    ip = (ip or "").strip()
    return ip in {"127.0.0.1", "::1", "localhost"}

def _parse_host_header(host_header: str) -> tuple[Optional[str], Optional[int]]:
    host_header = (host_header or "").strip()
    if not host_header:
        return None, None
    # Host header is typically "host:port" for non-default ports.
    if host_header.startswith("[") and "]" in host_header:
        # IPv6: "[::1]:7070"
        host_part, _, port_part = host_header.partition("]:")
        host = host_part.lstrip("[")
        port = None
        try:
            port = int(port_part) if port_part else None
        except Exception:
            port = None
        return host, port
    if ":" in host_header:
        host, _, port_part = host_header.rpartition(":")
        try:
            return host, int(port_part)
        except Exception:
            return host, None
    return host_header, None

def _parse_origin(origin: str) -> tuple[Optional[str], Optional[int], Optional[str]]:
    origin = (origin or "").strip()
    if not origin:
        return None, None, None
    try:
        u = urlparse(origin)
        return u.hostname, (u.port or None), u.scheme
    except Exception:
        return None, None, None

def _origin_is_trusted(origin: str, host_header: str) -> bool:
    """
    Local HTTP agents are a classic target for browser-based attacks.
    Rule: if a browser sends an Origin header, only accept it if it is:
      - loopback (localhost/127.0.0.1/::1), OR
      - same-origin as the request Host header (so the agent-served UI works).
    Non-browser clients usually omit Origin; those are handled separately.
    """
    oh, op, scheme = _parse_origin(origin)
    if not oh:
        return False

    # Tauri desktop origins (for the launcher UI). Allowing these does not enable
    # arbitrary websites to access localhost because a hostile website cannot
    # spoof the browser Origin to `tauri://localhost`.
    if scheme == "tauri" and oh == "localhost":
        return True

    if scheme not in {"http", "https"}:
        return False

    if oh in {"localhost", "127.0.0.1", "::1", "tauri.localhost"}:
        return True
    hh, hp = _parse_host_header(host_header)
    if not hh:
        return False
    # If the agent is accessed via LAN IP/hostname and serves its own UI, allow same-origin.
    if oh == hh and (hp is None or op is None or hp == op):
        return True
    return False

def _reject_if_disallowed_origin(handler) -> bool:
    """
    If Origin is present and not trusted, reject early to mitigate CSRF and
    cross-site localhost attacks.
    """
    origin = (handler.headers.get("Origin") or "").strip()
    if not origin:
        return False
    host_header = (handler.headers.get("Host") or "").strip()
    if _origin_is_trusted(origin, host_header):
        return False
    text_response(handler, "Forbidden", status=403)
    return True

def _maybe_send_cors_headers(handler):
    """
    Only emit CORS headers for trusted origins. We avoid wildcard CORS to prevent
    arbitrary websites from reading data from the local agent.
    """
    origin = (handler.headers.get("Origin") or "").strip()
    if not origin:
        return
    host_header = (handler.headers.get("Host") or "").strip()
    if not _origin_is_trusted(origin, host_header):
        return
    handler.send_header("Access-Control-Allow-Origin", origin)
    handler.send_header("Vary", "Origin")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type,X-POS-Session")
    handler.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    handler.send_header("Access-Control-Max-Age", "600")


def _admin_pin_required(client_ip: str, cfg: dict) -> bool:
    # Require admin session when:
    # - request originates from non-loopback (LAN exposure), OR
    # - require_admin_pin is explicitly enabled.
    if cfg.get("require_admin_pin"):
        return True
    return not _is_loopback(client_ip)


class _JsonBodyError(Exception):
    def __init__(self, *, status: int, payload: dict):
        super().__init__(str(payload.get("error") or "json_body_error"))
        self.status = int(status or 400)
        self.payload = payload or {"error": "invalid_json"}


def _clean_expired_sessions(cur):
    now = datetime.utcnow().isoformat()
    cur.execute("DELETE FROM pos_local_sessions WHERE expires_at IS NOT NULL AND expires_at < ?", (now,))


def _validate_admin_session(token: str) -> bool:
    token = (token or "").strip()
    if not token:
        return False
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        _clean_expired_sessions(cur)
        cur.execute("SELECT 1 FROM pos_local_sessions WHERE token = ? LIMIT 1", (token,))
        ok = cur.fetchone() is not None
        conn.commit()
        return ok


def _create_admin_session(hours: int) -> dict:
    hours_i = int(hours or 12)
    if hours_i <= 0 or hours_i > 24 * 14:
        hours_i = 12
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.utcnow() + timedelta(hours=hours_i)).isoformat()
    with db_connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO pos_local_sessions (token, expires_at) VALUES (?, ?)",
            (token, expires_at),
        )
        conn.commit()
    return {"token": token, "expires_at": expires_at}


def _set_admin_pin(cfg: dict, pin: str):
    pin = (pin or "").strip()
    if len(pin) < 4:
        raise ValueError("pin must be at least 4 digits")
    ph = bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    cfg["admin_pin_hash"] = ph
    save_config(cfg)
    return ph


def _verify_admin_pin(cfg: dict, pin: str) -> bool:
    pin = (pin or "").strip()
    if not pin:
        return False
    ph = (cfg.get("admin_pin_hash") or "").encode("utf-8")
    if not ph:
        return False
    try:
        return bcrypt.checkpw(pin.encode("utf-8"), ph)
    except Exception:
        return False

def _public_config(cfg: dict) -> dict:
    """
    Return a config payload safe to expose via the local HTTP API.

    Even if the agent is LAN-exposed intentionally, we never want to leak the
    backend device token or admin PIN hash via unauthenticated GET requests.
    """
    safe = dict(cfg or {})
    # Allow the UI to show whether a token exists without exposing it.
    safe["has_device_token"] = bool(((cfg or {}).get("device_token") or "").strip())
    safe.pop("device_token", None)
    safe.pop("admin_pin_hash", None)
    return safe

def init_db():
    if not os.path.exists(SCHEMA_PATH):
        raise RuntimeError(f"Missing schema file: {SCHEMA_PATH}")
    with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
        schema = f.read()
    with db_connect() as conn:
        conn.executescript(schema)
        # SQLite CREATE TABLE IF NOT EXISTS does not add new columns. Keep a tiny
        # runtime migration layer for local caches.
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(local_customers_cache)")
        cols = {r[1] for r in cur.fetchall()}
        wanted = {
            "membership_no": "TEXT",
            "is_member": "INTEGER DEFAULT 0",
            "membership_expires_at": "TEXT",
            "payment_terms_days": "INTEGER DEFAULT 0",
            "credit_limit_usd": "REAL DEFAULT 0",
            "credit_limit_lbp": "REAL DEFAULT 0",
            "credit_balance_usd": "REAL DEFAULT 0",
            "credit_balance_lbp": "REAL DEFAULT 0",
            "loyalty_points": "REAL DEFAULT 0",
            "price_list_id": "TEXT",
            "is_active": "INTEGER DEFAULT 1",
        }
        for col, ddl in wanted.items():
            if col not in cols:
                cur.execute(f"ALTER TABLE local_customers_cache ADD COLUMN {col} {ddl}")

        cur.execute("PRAGMA table_info(local_items_cache)")
        item_cols = {r[1] for r in cur.fetchall()}
        item_wanted = {
            "is_active": "INTEGER DEFAULT 1",
            "category_id": "TEXT",
            "brand": "TEXT",
            "short_name": "TEXT",
            "description": "TEXT",
            "track_batches": "INTEGER DEFAULT 0",
            "track_expiry": "INTEGER DEFAULT 0",
            "default_shelf_life_days": "INTEGER",
            "min_shelf_life_days_for_sale": "INTEGER",
            "expiry_warning_days": "INTEGER",
        }
        for col, ddl in item_wanted.items():
            if col not in item_cols:
                cur.execute(f"ALTER TABLE local_items_cache ADD COLUMN {col} {ddl}")

        cur.execute("PRAGMA table_info(local_item_barcodes_cache)")
        bc_cols = {r[1] for r in cur.fetchall()}
        if "uom_code" not in bc_cols:
            cur.execute("ALTER TABLE local_item_barcodes_cache ADD COLUMN uom_code TEXT")
        # Explicit indexes for fast cashier workflows (barcode and customer lookup hot paths).
        cur.executescript(
            """
            CREATE INDEX IF NOT EXISTS idx_local_items_active_sku ON local_items_cache(is_active, sku);
            CREATE INDEX IF NOT EXISTS idx_local_items_barcode ON local_items_cache(barcode);
            CREATE INDEX IF NOT EXISTS idx_local_items_name ON local_items_cache(name);
            CREATE INDEX IF NOT EXISTS idx_local_prices_item_effective ON local_prices_cache(item_id, effective_from);

            CREATE INDEX IF NOT EXISTS idx_local_customers_active_name ON local_customers_cache(is_active, name);
            CREATE INDEX IF NOT EXISTS idx_local_customers_membership ON local_customers_cache(membership_no);
            CREATE INDEX IF NOT EXISTS idx_local_customers_phone ON local_customers_cache(phone);
            CREATE INDEX IF NOT EXISTS idx_local_customers_email ON local_customers_cache(email);

            CREATE INDEX IF NOT EXISTS idx_local_cashiers_active_name ON local_cashiers_cache(is_active, name);
            CREATE INDEX IF NOT EXISTS idx_pos_outbox_status_created ON pos_outbox_events(status, created_at);
            """
        )
        conn.commit()


def json_response(handler, payload, status=200):
    body = json.dumps(payload).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json')
    _maybe_send_cors_headers(handler)
    handler.end_headers()
    handler.wfile.write(body)


def text_response(handler, body, status=200, content_type='text/plain'):
    handler.send_response(status)
    handler.send_header('Content-Type', content_type)
    _maybe_send_cors_headers(handler)
    handler.end_headers()
    handler.wfile.write(body.encode('utf-8'))


def file_response(handler, path):
    if not os.path.exists(path) or not os.path.isfile(path):
        handler.send_response(404)
        handler.end_headers()
        return
    try:
        import mimetypes

        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    except Exception:
        ctype = "application/octet-stream"
    try:
        with open(path, 'rb') as f:
            data = f.read()
        handler.send_response(200)
        handler.send_header('Content-Type', ctype)
        handler.end_headers()
        handler.wfile.write(data)
    except Exception:
        handler.send_response(404)
        handler.end_headers()
        return


def fetch_json(url, headers=None):
    req = Request(url, headers=headers or {}, method='GET')
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode('utf-8'))

def _fetch_json_timeout(url, headers=None, timeout_s: float = 1.0):
    req = Request(url, headers=headers or {}, method="GET")
    with urlopen(req, timeout=max(0.2, float(timeout_s or 1.0))) as resp:
        return json.loads(resp.read().decode("utf-8"))


def post_json(url, payload, headers=None):
    data = json.dumps(payload).encode('utf-8')
    req = Request(url, data=data, headers=headers or {}, method='POST')
    req.add_header('Content-Type', 'application/json')
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode('utf-8'))

def _run_cmd(args: list[str], timeout_s: float = 2.5) -> tuple[int, str, str]:
    """
    Small helper to shell out for OS-level printer enumeration/printing.
    Returns (exit_code, stdout, stderr) as strings.
    """
    try:
        p = subprocess.run(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=max(0.2, float(timeout_s or 2.5)),
            text=True,
        )
        return int(p.returncode or 0), str(p.stdout or ""), str(p.stderr or "")
    except Exception as ex:
        return 1, "", str(ex)

def list_system_printers() -> dict:
    """
    Enumerate printers available on this machine (best-effort).
    This is used for mapping receipts to printers in kiosk flows.
    """
    out: dict = {"printers": [], "default_printer": None, "error": None}

    # Windows: query via PowerShell (Get-Printer).
    if sys.platform.startswith("win"):
        ps = shutil.which("powershell") or shutil.which("pwsh")
        if not ps:
            out["error"] = "powershell not found"
            return out
        # Use JSON so we can reliably detect the default printer too.
        cmd = "Get-Printer | Select-Object Name, Default | ConvertTo-Json -Compress"
        code, stdout, stderr = _run_cmd([ps, "-NoProfile", "-Command", cmd], timeout_s=4.0)
        if code != 0:
            out["error"] = (stderr or "printer query failed").strip()
            return out
        raw = (stdout or "").strip()
        if not raw:
            return out
        try:
            obj = json.loads(raw)
        except Exception:
            # Fallback: older PS / locale noise. At least return names if possible.
            names = [ln.strip() for ln in raw.splitlines() if ln.strip()]
            out["printers"] = [{"name": n, "is_default": False} for n in names]
            return out
        rows = obj if isinstance(obj, list) else ([obj] if isinstance(obj, dict) else [])
        printers = []
        default_name = None
        for r in rows:
            if not isinstance(r, dict):
                continue
            name = str(r.get("Name") or "").strip()
            if not name:
                continue
            is_def = bool(r.get("Default"))
            if is_def and not default_name:
                default_name = name
            printers.append({"name": name, "is_default": is_def})
        out["printers"] = printers
        out["default_printer"] = default_name
        return out

    # macOS/Linux: use CUPS tools if available.
    lpstat = shutil.which("lpstat")
    if not lpstat:
        out["error"] = "lpstat not found"
        return out

    # Default printer
    code, stdout, _stderr = _run_cmd([lpstat, "-d"], timeout_s=2.0)
    if code == 0:
        # Example: "system default destination: Printer_Name"
        for ln in (stdout or "").splitlines():
            if "default destination" in ln:
                parts = ln.split(":", 1)
                if len(parts) == 2:
                    out["default_printer"] = parts[1].strip() or None

    # Printer list
    code, stdout, stderr = _run_cmd([lpstat, "-p"], timeout_s=2.5)
    if code != 0:
        out["error"] = (stderr or "printer query failed").strip()
        return out

    printers = []
    for ln in (stdout or "").splitlines():
        ln = ln.strip()
        if not ln.startswith("printer "):
            continue
        # Common form: "printer NAME is idle.  enabled since ..."
        parts = ln.split()
        if len(parts) < 2:
            continue
        name = parts[1].strip()
        if not name:
            continue
        printers.append({"name": name, "is_default": (name == out.get("default_printer"))})

    out["printers"] = printers
    return out


def _setup_req_json(url: str, method: str = "GET", payload=None, headers=None, timeout_s: float = 12.0):
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    req = Request(url, data=body, headers=headers or {}, method=method.upper())
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    with urlopen(req, timeout=max(0.5, float(timeout_s or 12.0))) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def _setup_req_json_safe(url: str, method: str = "GET", payload=None, headers=None, timeout_s: float = 12.0):
    try:
        return _setup_req_json(url, method=method, payload=payload, headers=headers, timeout_s=timeout_s), None, None
    except HTTPError as ex:
        detail = ""
        try:
            raw = ex.read().decode("utf-8", errors="ignore")
        except Exception:
            raw = ""
        if raw:
            try:
                obj = json.loads(raw)
                detail = str(obj.get("detail") or obj.get("error") or raw)
            except Exception:
                detail = raw
        else:
            detail = str(ex.reason or ex)
        return None, int(ex.code or 500), detail
    except URLError as ex:
        return None, 502, str(ex.reason or ex)
    except Exception as ex:
        return None, 500, str(ex)


def _normalize_api_base_url(v) -> str:
    return str(v or "").strip().rstrip("/")


_ACTIVE_API_CACHE = {
    "checked_at": 0.0,
    "base": "",
    "mode": "",
    "detail": "",
}
_ACTIVE_API_TTL_S = 3.0


def _configured_edge_base(cfg: dict) -> str:
    # Prefer explicit edge_api_base_url; fall back to api_base_url for backwards compatibility.
    return _normalize_api_base_url(cfg.get("edge_api_base_url") or cfg.get("api_base_url"))


def _configured_cloud_base(cfg: dict) -> str:
    return _normalize_api_base_url(cfg.get("cloud_api_base_url") or "")


def _probe_health(base: str, timeout_s: float = 0.6) -> dict:
    base = _normalize_api_base_url(base)
    if not base:
        return {"ok": False, "error": "missing base", "latency_ms": None, "url": ""}
    url = f"{base}/health"
    started = time.time()
    try:
        data = _fetch_json_timeout(url, headers=None, timeout_s=timeout_s)
        ok = bool((data or {}).get("ok", True))
        lat = int((time.time() - started) * 1000)
        return {"ok": ok, "error": None, "latency_ms": lat, "url": url}
    except Exception as ex:
        lat = int((time.time() - started) * 1000)
        return {"ok": False, "error": str(ex), "latency_ms": lat, "url": url}


def _probe_auth(base: str, cfg: dict, timeout_s: float = 1.0) -> dict:
    base = _normalize_api_base_url(base)
    if not base:
        return {"ok": False, "status": 400, "error": "missing base", "latency_ms": None, "url": ""}
    device_id = (cfg.get("device_id") or "").strip()
    token = (cfg.get("device_token") or "").strip()
    if not device_id or not token:
        return {
            "ok": False,
            "status": 400,
            "error": "missing device_id or device_token",
            "latency_ms": None,
            "url": f"{base}/pos/config",
        }
    url = f"{base}/pos/config"
    started = time.time()
    _data, status, err = _setup_req_json_safe(url, method="GET", payload=None, headers=device_headers(cfg), timeout_s=timeout_s)
    lat = int((time.time() - started) * 1000)
    if status is None:
        return {"ok": True, "status": 200, "error": None, "latency_ms": lat, "url": url}
    return {"ok": False, "status": int(status), "error": str(err or "auth failed"), "latency_ms": lat, "url": url}


def _resolve_active_api_base(cfg: dict, *, force: bool = False) -> tuple[str, str, str]:
    """
    Returns (base_url, mode, detail) where mode is 'edge' or 'cloud'.
    Prefers edge when it is reachable and auth works, otherwise falls back to cloud.
    Uses a short TTL cache to avoid probing on every request.
    """
    now = time.time()
    if not force:
        cached = _ACTIVE_API_CACHE
        if cached.get("base") and (now - float(cached.get("checked_at") or 0)) < _ACTIVE_API_TTL_S:
            return str(cached["base"]), str(cached.get("mode") or ""), str(cached.get("detail") or "")

    edge = _configured_edge_base(cfg)
    cloud = _configured_cloud_base(cfg)
    if edge and not cloud:
        base, mode, detail = edge, "edge", "only edge configured"
    elif cloud and not edge:
        base, mode, detail = cloud, "cloud", "only cloud configured"
    elif not edge and not cloud:
        base, mode, detail = "", "", "missing api base urls"
    else:
        # Both configured: try edge first, then cloud.
        detail_parts: list[str] = []

        edge_auth = _probe_auth(edge, cfg, timeout_s=0.8)
        if edge_auth.get("ok"):
            base, mode, detail = edge, "edge", "edge auth ok"
        else:
            detail_parts.append(f"edge auth failed ({edge_auth.get('status')}): {edge_auth.get('error')}")
            cloud_auth = _probe_auth(cloud, cfg, timeout_s=1.3)
            if cloud_auth.get("ok"):
                base, mode, detail = cloud, "cloud", "cloud auth ok"
            else:
                detail_parts.append(f"cloud auth failed ({cloud_auth.get('status')}): {cloud_auth.get('error')}")
                # Last resort: pick whichever responds to /health.
                edge_h = _probe_health(edge, timeout_s=0.6)
                if edge_h.get("ok"):
                    base, mode = edge, "edge"
                    detail_parts.append("picked edge by /health")
                else:
                    cloud_h = _probe_health(cloud, timeout_s=1.0)
                    if cloud_h.get("ok"):
                        base, mode = cloud, "cloud"
                        detail_parts.append("picked cloud by /health")
                    else:
                        # If both are down, prefer edge (LAN) to keep retrying fast.
                        base, mode = edge, "edge"
                        detail_parts.append("both offline; defaulted to edge")
                detail = " · ".join([p for p in detail_parts if p]) or "resolved by health"

    _ACTIVE_API_CACHE["checked_at"] = now
    _ACTIVE_API_CACHE["base"] = base
    _ACTIVE_API_CACHE["mode"] = mode
    _ACTIVE_API_CACHE["detail"] = detail
    return base, mode, detail


def _require_api_base(cfg: dict) -> str:
    base, _mode, _detail = _resolve_active_api_base(cfg, force=False)
    if not base:
        raise ValueError("missing api_base_url")
    return base


def device_headers(cfg):
    return {
        'X-Device-Id': cfg.get('device_id') or '',
        'X-Device-Token': cfg.get('device_token') or ''
    }

def count_outbox_pending() -> int:
    with db_connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(1) FROM pos_outbox_events WHERE status='pending'")
        row = cur.fetchone()
        try:
            return int(row[0] if row else 0)
        except Exception:
            return 0


def edge_health(cfg: dict, timeout_s: float = 0.8) -> dict:
    base, mode, detail = _resolve_active_api_base(cfg, force=True)
    out = _probe_health(base, timeout_s=timeout_s)
    out["mode"] = mode
    out["detail"] = detail
    out["active_base_url"] = base
    out["edge_api_base_url"] = _configured_edge_base(cfg)
    out["cloud_api_base_url"] = _configured_cloud_base(cfg)
    return out

def edge_auth_check(cfg: dict, timeout_s: float = 1.2) -> dict:
    """
    Validate device credentials against a device-scoped endpoint.
    This is the quickest way to determine whether the POS will actually be able to sync,
    even if /health is reachable.
    """
    base, mode, detail = _resolve_active_api_base(cfg, force=True)
    out = _probe_auth(base, cfg, timeout_s=timeout_s)
    out["mode"] = mode
    out["detail"] = detail
    out["active_base_url"] = base
    out["edge_api_base_url"] = _configured_edge_base(cfg)
    out["cloud_api_base_url"] = _configured_cloud_base(cfg)
    return out


def submit_single_event(cfg: dict, event_id: str, event_type: str, payload: dict, created_at: str) -> tuple[bool, dict]:
    """
    Submit a single outbox event immediately to the edge server.
    Used for higher-risk ops like credit sales and returns so we don't print a receipt
    unless the edge accepted the document for posting.
    """
    try:
        base = _require_api_base(cfg)
    except Exception:
        base = ""
    company_id = (cfg.get("company_id") or "").strip()
    device_id = (cfg.get("device_id") or "").strip()
    if not base or not company_id or not device_id:
        return False, {"error": "missing edge configuration"}
    if not (cfg.get("device_token") or "").strip():
        return False, {"error": "missing device token"}
    bundle = {
        "company_id": company_id,
        "device_id": device_id,
        "events": [
            {"event_id": event_id, "event_type": event_type, "payload": payload, "created_at": created_at},
        ],
    }
    res = post_json(f"{base.rstrip('/')}/pos/outbox/submit", bundle, headers=device_headers(cfg))
    accepted = set(res.get("accepted") or [])
    return (event_id in accepted), res


def get_sync_cursor(resource: str):
    resource = (resource or "").strip()
    if not resource:
        return None, None
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT cursor, cursor_id FROM pos_sync_cursors WHERE resource = ?", (resource,))
        row = cur.fetchone()
        if not row:
            return None, None
        return row["cursor"], row["cursor_id"]


def set_sync_cursor(resource: str, cursor=None, cursor_id=None):
    resource = (resource or "").strip()
    if not resource:
        return
    with db_connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO pos_sync_cursors (resource, cursor, cursor_id, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(resource) DO UPDATE SET
              cursor=excluded.cursor,
              cursor_id=excluded.cursor_id,
              updated_at=excluded.updated_at
            """,
            (resource, cursor, cursor_id, datetime.utcnow().isoformat()),
        )
        conn.commit()


def clear_sync_cursors(resources=None):
    with db_connect() as conn:
        cur = conn.cursor()
        if not resources:
            cur.execute("DELETE FROM pos_sync_cursors")
        else:
            cur.execute("DELETE FROM pos_sync_cursors WHERE resource IN (%s)" % ",".join(["?"] * len(resources)), tuple(resources))
        conn.commit()


def apply_inbox_events(events, cfg: dict):
    """
    Apply server->device inbox events.
    Supported:
    - config.patch: {"set": {...}}
    - sync.reset: {"resources": ["catalog","customers",...]} (omit => all)
    - message: freeform payload
    """
    now = datetime.utcnow().isoformat()
    applied_ids = []
    changed_cfg = False
    for ev in events or []:
        eid = ev.get("id") or ev.get("event_id")
        etype = (ev.get("event_type") or "").strip()
        payload = ev.get("payload_json") or ev.get("payload") or {}
        try:
            # psycopg returns jsonb as dict already; keep dict
            if isinstance(payload, str):
                payload = json.loads(payload)
        except Exception:
            payload = {}

        if eid:
            applied_ids.append(str(eid))
            with db_connect() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO pos_inbox_events (event_id, event_type, payload_json, applied_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(event_id) DO NOTHING
                    """,
                    (str(eid), etype, json.dumps(payload), now),
                )
                conn.commit()

        if etype == "config.patch":
            to_set = (payload or {}).get("set") or {}
            if isinstance(to_set, dict):
                for k, v in to_set.items():
                    cfg[k] = v
                    changed_cfg = True
        elif etype == "sync.reset":
            resources = (payload or {}).get("resources") or None
            if resources and isinstance(resources, list):
                clear_sync_cursors(resources=[str(r) for r in resources if str(r)])
            else:
                clear_sync_cursors(resources=None)
        else:
            # Unknown events are stored for audit/visibility.
            pass

    if changed_cfg:
        save_config(cfg)
    return applied_ids


def sync_resource_snapshot(base: str, headers: dict, resource: str, url: str, key: str, upsert_fn):
    res = fetch_json(url, headers=headers)
    rows = (res or {}).get(key) or []
    upsert_fn(rows)
    server_time = (res or {}).get("server_time") or datetime.utcnow().isoformat()
    set_sync_cursor(resource, server_time, None)
    return {"mode": "snapshot", "count": len(rows)}


def sync_resource_delta(base: str, headers: dict, resource: str, url_base: str, key: str, upsert_fn):
    since, since_id = get_sync_cursor(resource)
    if not since:
        return None
    qs = [f"since={quote(str(since))}"]
    if since_id:
        qs.append(f"since_id={quote(str(since_id))}")
    url = url_base + ("&" if "?" in url_base else "?") + "&".join(qs)
    res = fetch_json(url, headers=headers)
    rows = (res or {}).get(key) or []
    upsert_fn(rows)
    set_sync_cursor(resource, (res or {}).get("next_cursor") or since, (res or {}).get("next_cursor_id") or since_id)
    return {"mode": "delta", "count": len(rows)}


def get_items():
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT i.id, i.sku, i.barcode, i.name, i.unit_of_measure,
                   i.category_id, i.brand, i.short_name, i.description,
                   i.track_batches, i.track_expiry,
                   i.default_shelf_life_days, i.min_shelf_life_days_for_sale, i.expiry_warning_days,
                   p.price_usd, p.price_lbp
            FROM local_items_cache i
            LEFT JOIN (
              SELECT item_id, price_usd, price_lbp
              FROM local_prices_cache lp
              WHERE lp.effective_from = (
                SELECT MAX(effective_from) FROM local_prices_cache WHERE item_id = lp.item_id
              )
            ) p ON p.item_id = i.id
            WHERE i.is_active = 1
            ORDER BY i.sku
            """
        )
        return [dict(r) for r in cur.fetchall()]


def get_barcodes():
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, item_id, barcode, qty_factor, uom_code, label, is_primary
            FROM local_item_barcodes_cache
            ORDER BY is_primary DESC, updated_at DESC
            """
        )
        return [dict(r) for r in cur.fetchall()]

def get_cashiers():
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, is_active, updated_at
            FROM local_cashiers_cache
            WHERE is_active = 1
            ORDER BY name
            """
        )
        return [dict(r) for r in cur.fetchall()]

def get_customers(query: str = "", limit: int = 50):
    raw_query = (query or "").strip()
    query = raw_query.lower()
    limit_i = max(1, min(int(limit or 50), 500))
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        select_sql = """
            SELECT id, name, phone, email,
                   membership_no, is_member, membership_expires_at,
                   payment_terms_days,
                   credit_limit_usd, credit_limit_lbp,
                   credit_balance_usd, credit_balance_lbp,
                   loyalty_points,
                   price_list_id,
                   is_active,
                   updated_at
            FROM local_customers_cache
        """

        # Fast path for scanner-like exact inputs (membership/id/phone/email).
        # This keeps customer pick instant even with very large local customer sets.
        if query:
            exact_hits = []
            try:
                cur.execute(
                    f"""
                    {select_sql}
                    WHERE is_active = 1 AND (
                          lower(id) = ?
                       OR lower(COALESCE(membership_no, '')) = ?
                       OR lower(COALESCE(phone, '')) = ?
                       OR lower(COALESCE(email, '')) = ?
                    )
                    ORDER BY name
                    LIMIT ?
                    """,
                    (query, query, query, query, limit_i),
                )
                exact_hits = [dict(r) for r in cur.fetchall()]
            except Exception:
                exact_hits = []
            if exact_hits:
                return exact_hits

        if query:
            needle = f"%{query}%"
            cur.execute(
                """
                SELECT id, name, phone, email,
                       membership_no, is_member, membership_expires_at,
                       payment_terms_days,
                       credit_limit_usd, credit_limit_lbp,
                       credit_balance_usd, credit_balance_lbp,
                       loyalty_points,
                       price_list_id,
                       is_active,
                       updated_at
                FROM local_customers_cache
                WHERE is_active = 1 AND (
                      lower(name) LIKE ?
                   OR lower(COALESCE(phone, '')) LIKE ?
                   OR lower(COALESCE(email, '')) LIKE ?
                   OR lower(COALESCE(membership_no, '')) LIKE ?
                   OR lower(id) LIKE ?
                )
                ORDER BY name
                LIMIT ?
                """,
                (needle, needle, needle, needle, needle, limit_i),
            )
        else:
            cur.execute(
                """
                SELECT id, name, phone, email,
                       membership_no, is_member, membership_expires_at,
                       payment_terms_days,
                       credit_limit_usd, credit_limit_lbp,
                       credit_balance_usd, credit_balance_lbp,
                       loyalty_points,
                       price_list_id,
                       is_active,
                       updated_at
                FROM local_customers_cache
                WHERE is_active = 1
                ORDER BY name
                LIMIT ?
                """,
                (limit_i,),
            )
        return [dict(r) for r in cur.fetchall()]


def get_customer_by_id(customer_id: str):
    customer_id = (customer_id or "").strip()
    if not customer_id:
        return None
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, phone, email,
                   membership_no, is_member, membership_expires_at,
                   payment_terms_days,
                   credit_limit_usd, credit_limit_lbp,
                   credit_balance_usd, credit_balance_lbp,
                   loyalty_points,
                   price_list_id,
                   is_active,
                   updated_at
            FROM local_customers_cache
            WHERE id = ?
            """,
            (customer_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def upsert_customers(customers):
    with db_connect() as conn:
        cur = conn.cursor()
        for c in customers:
            cur.execute(
                """
                INSERT INTO local_customers_cache
                  (id, name, phone, email,
                   membership_no, is_member, membership_expires_at,
                   payment_terms_days,
                   credit_limit_usd, credit_limit_lbp,
                   credit_balance_usd, credit_balance_lbp,
                   loyalty_points,
                   price_list_id,
                   is_active,
                   updated_at)
                VALUES
                  (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name=excluded.name,
                  phone=excluded.phone,
                  email=excluded.email,
                  membership_no=excluded.membership_no,
                  is_member=excluded.is_member,
                  membership_expires_at=excluded.membership_expires_at,
                  payment_terms_days=excluded.payment_terms_days,
                  credit_limit_usd=excluded.credit_limit_usd,
                  credit_limit_lbp=excluded.credit_limit_lbp,
                  credit_balance_usd=excluded.credit_balance_usd,
                  credit_balance_lbp=excluded.credit_balance_lbp,
                  loyalty_points=excluded.loyalty_points,
                  price_list_id=excluded.price_list_id,
                  is_active=excluded.is_active,
                  updated_at=excluded.updated_at
                """,
                (
                    c.get("id"),
                    c.get("name"),
                    c.get("phone"),
                    c.get("email"),
                    (c.get("membership_no") or "").strip() or None,
                    1 if c.get("is_member") else 0,
                    c.get("membership_expires_at"),
                    int(c.get("payment_terms_days") or 0),
                    float(c.get("credit_limit_usd") or 0),
                    float(c.get("credit_limit_lbp") or 0),
                    float(c.get("credit_balance_usd") or 0),
                    float(c.get("credit_balance_lbp") or 0),
                    float(c.get("loyalty_points") or 0),
                    c.get("price_list_id"),
                    1 if c.get("is_active", True) else 0,
                    (c.get("updated_at") or c.get("changed_at") or datetime.utcnow().isoformat()),
                ),
            )
        conn.commit()

def upsert_cashiers(cashiers):
    with db_connect() as conn:
        cur = conn.cursor()
        for c in cashiers:
            cur.execute(
                """
                INSERT INTO local_cashiers_cache (id, name, pin_hash, is_active, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name=excluded.name,
                  pin_hash=excluded.pin_hash,
                  is_active=excluded.is_active,
                  updated_at=excluded.updated_at
                """,
                (
                    c.get("id"),
                    c.get("name"),
                    c.get("pin_hash"),
                    1 if c.get("is_active") else 0,
                    datetime.utcnow().isoformat(),
                ),
            )
        conn.commit()

def upsert_promotions(promotions):
    """
    Store promotions as a local, POS-evaluable rules cache (offline-first).

    Expected `promotions` shape is the payload from backend `/pos/promotions/catalog`.
    """
    with db_connect() as conn:
        cur = conn.cursor()
        for p in promotions or []:
            pid = str(p.get("id") or "")
            if not pid:
                continue
            rules = {
                "id": pid,
                "code": p.get("code"),
                "name": p.get("name"),
                "starts_on": p.get("starts_on"),
                "ends_on": p.get("ends_on"),
                "is_active": bool(p.get("is_active", True)),
                "priority": int(p.get("priority") or 0),
                "items": p.get("items") or [],
            }
            cur.execute(
                """
                INSERT INTO local_promotions_cache (id, name, rules_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name=excluded.name,
                  rules_json=excluded.rules_json,
                  updated_at=excluded.updated_at
                """,
                (
                    pid,
                    (p.get("name") or "").strip() or (p.get("code") or "").strip(),
                    json.dumps(rules),
                    (p.get("updated_at") or datetime.utcnow().isoformat()),
                ),
            )
        conn.commit()


def get_promotions():
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, rules_json, updated_at
            FROM local_promotions_cache
            ORDER BY updated_at DESC
            """
        )
        rows = []
        for r in cur.fetchall():
            try:
                rules = json.loads(r["rules_json"] or "{}")
            except Exception:
                rules = {}
            rows.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "rules": rules,
                    "updated_at": r["updated_at"],
                }
            )
        return rows


def save_receipt(receipt_type: str, receipt_obj: dict):
    rid = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()
    with db_connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO pos_receipts (id, receipt_type, receipt_json, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (rid, receipt_type, json.dumps(receipt_obj), created_at),
        )
        conn.commit()
    return rid


def get_last_receipt():
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, receipt_type, receipt_json, created_at
            FROM pos_receipts
            ORDER BY created_at DESC
            LIMIT 1
            """
        )
        r = cur.fetchone()
        if not r:
            return None
        try:
            obj = json.loads(r["receipt_json"] or "{}")
        except Exception:
            obj = {}
        return {
            "id": r["id"],
            "receipt_type": r["receipt_type"],
            "receipt": obj,
            "created_at": r["created_at"],
        }


def _receipt_html(receipt_row):
    if not receipt_row:
        return """<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Receipt</title></head><body><p>No receipt yet.</p></body></html>"""

    r = receipt_row.get("receipt") or {}
    lines = r.get("lines") or []
    totals = r.get("totals") or {}

    def e(x):
        return html.escape(str(x if x is not None else ""))

    def fmt_usd(x):
        try:
            return f"{float(x or 0):.2f}"
        except Exception:
            return "0.00"

    def fmt_lbp(x):
        try:
            return f"{int(round(float(x or 0))):,}"
        except Exception:
            return "0"

    title = "Sale Receipt" if receipt_row.get("receipt_type") == "sale" else "Return Receipt"
    cashier = r.get("cashier") or {}

    line_rows = []
    for ln in lines:
        name = (ln.get("name") or "").strip() or (ln.get("sku") or "").strip() or ln.get("item_id") or ""
        qty_entered = ln.get("qty_entered")
        qty = qty_entered if qty_entered is not None else (ln.get("qty") or 0)
        uom = (ln.get("uom") or "").strip()
        qty_label = f"{qty} {uom}".strip()
        line_rows.append(
            f"""
            <tr>
              <td class="name">{e(name)}</td>
              <td class="qty">{e(qty_label)}</td>
              <td class="amt">{e(fmt_usd(ln.get("line_total_usd")))}</td>
            </tr>
            """
        )

    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
	    <title>{e(title)}</title>
	    <style>
	      :root {{
	        --w: 80mm;
	        --fg: #111;
	        --muted: #666;
	        --border: #ddd;
	        /* Avoid external font fetches so receipt printing stays fast offline. */
	        --mono: "Roboto", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, "Noto Sans", "Liberation Sans", sans-serif;
	        --sans: "Roboto", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, "Noto Sans", "Liberation Sans", sans-serif;
	      }}
      body {{
        margin: 0;
        padding: 10px;
        color: var(--fg);
        font-family: var(--sans);
        max-width: var(--w);
      }}
      .muted {{ color: var(--muted); }}
      .mono {{ font-family: var(--mono); }}
      h1 {{ font-size: 16px; margin: 0 0 2px; }}
      h2 {{ font-size: 12px; margin: 0 0 12px; font-weight: 600; }}
      .meta {{ font-size: 11px; line-height: 1.35; margin-bottom: 10px; }}
      table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
      thead th {{ text-align: left; border-bottom: 1px solid var(--border); padding: 6px 0; }}
      tbody td {{ padding: 6px 0; border-bottom: 1px dashed #eee; vertical-align: top; }}
      td.qty, th.qty {{ text-align: right; width: 18%; }}
      td.amt, th.amt {{ text-align: right; width: 28%; }}
      .totals {{ margin-top: 10px; font-size: 12px; }}
      .row {{ display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; }}
      .actions {{ margin-top: 12px; display: flex; gap: 8px; }}
      button {{
        border: 1px solid var(--border);
        background: white;
        padding: 8px 10px;
        border-radius: 10px;
        font-size: 12px;
        cursor: pointer;
      }}
      @media print {{
        .actions {{ display: none; }}
        body {{ padding: 0; }}
      }}
    </style>
  </head>
  <body>
    <h1>AH Trading</h1>
    <h2>{e(title)}</h2>
    <div class="meta">
      <div class="muted">Time: <span class="mono">{e(r.get("created_at"))}</span></div>
      <div class="muted">Event: <span class="mono">{e(r.get("event_id"))}</span></div>
      <div class="muted">Shift: <span class="mono">{e(r.get("shift_id") or "-")}</span></div>
      <div class="muted">Cashier: <span>{e(cashier.get("name") or cashier.get("id") or "-")}</span></div>
      <div class="muted">Customer: <span class="mono">{e(r.get("customer_id") or "-")}</span></div>
      <div class="muted">Payment: <span>{e(r.get("payment_method") or "-")}</span></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th class="qty">Qty</th>
          <th class="amt">USD</th>
        </tr>
      </thead>
      <tbody>
        {''.join(line_rows)}
      </tbody>
    </table>

    <div class="totals">
      <div class="row"><span class="muted">Subtotal USD</span><strong class="mono">{e(fmt_usd(totals.get("base_usd")))}</strong></div>
      <div class="row"><span class="muted">VAT USD</span><strong class="mono">{e(fmt_usd(totals.get("tax_usd")))}</strong></div>
      <div class="row"><span class="muted">Total USD</span><strong class="mono">{e(fmt_usd(totals.get("total_usd")))}</strong></div>
      <div class="row"><span class="muted">Total LBP</span><strong class="mono">{e(fmt_lbp(totals.get("total_lbp")))}</strong></div>
    </div>

    <div class="actions">
      <button onclick="window.print()">Print</button>
      <button onclick="window.close()">Close</button>
    </div>
    <script>
      // Kiosk-friendly: auto-open print dialog shortly after load.
      window.addEventListener('load', () => setTimeout(() => window.print(), 250));
    </script>
  </body>
</html>"""


def _receipt_text(receipt_row, width: int = 42) -> str:
    """
    Plain-text receipt for thermal printers via OS spooling.
    Keeps dependencies minimal (no HTML->PDF rendering).
    """
    if not receipt_row:
        return "No receipt yet.\n"

    r = receipt_row.get("receipt") or {}
    lines = r.get("lines") or []
    totals = r.get("totals") or {}

    def clip(s: str) -> str:
        s = str(s or "")
        if len(s) <= width:
            return s
        return s[: max(0, width - 3)] + "..."

    def fmt_usd(x):
        try:
            return f"{float(x or 0):.2f}"
        except Exception:
            return "0.00"

    def fmt_lbp(x):
        try:
            return f"{int(round(float(x or 0))):,}"
        except Exception:
            return "0"

    out = []
    title = "SALE" if receipt_row.get("receipt_type") == "sale" else "RETURN"
    out.append("AH Trading")
    out.append(title)
    out.append(f"Time: {r.get('created_at') or '-'}")
    out.append(f"Event: {r.get('event_id') or '-'}")
    if r.get("shift_id"):
        out.append(f"Shift: {r.get('shift_id')}")
    if r.get("cashier", {}).get("name") or r.get("cashier", {}).get("id"):
        out.append(f"Cashier: {r.get('cashier', {}).get('name') or r.get('cashier', {}).get('id')}")
    if r.get("customer_id"):
        out.append(f"Customer: {r.get('customer_id')}")
    if r.get("payment_method"):
        out.append(f"Payment: {r.get('payment_method')}")
    out.append("-" * width)

    # Lines: name + qty + amount (USD)
    for ln in lines:
        name = (ln.get("name") or "").strip() or (ln.get("sku") or "").strip() or ln.get("item_id") or ""
        qty_entered = ln.get("qty_entered")
        qty = qty_entered if qty_entered is not None else (ln.get("qty") or 0)
        uom = (ln.get("uom") or "").strip()
        qty_label = f"{qty} {uom}".strip()
        amt = fmt_usd(ln.get("line_total_usd"))
        left = clip(name)
        # Right-align qty and amount where possible.
        right = f"{qty_label}  {amt}".strip()
        if len(right) >= width:
            out.append(left)
            out.append(clip(right))
        else:
            out.append(left[: max(0, width - len(right) - 1)] + " " + right)

    out.append("-" * width)
    out.append(f"Subtotal USD: {fmt_usd(totals.get('base_usd'))}")
    out.append(f"VAT USD:      {fmt_usd(totals.get('tax_usd'))}")
    out.append(f"Total USD:    {fmt_usd(totals.get('total_usd'))}")
    out.append(f"Total LBP:    {fmt_lbp(totals.get('total_lbp'))}")
    out.append("")
    return "\n".join(out) + "\n"


def _print_text_to_printer(text: str, printer: Optional[str] = None, copies: int = 1):
    try:
        copies_i = int(copies or 1)
    except Exception:
        copies_i = 1
    copies_i = max(1, min(10, copies_i))

    # Windows: use PowerShell pipeline to the print spooler.
    # Note: this prints as plain text via the installed printer driver.
    if sys.platform.startswith("win"):
        ps = shutil.which("powershell") or shutil.which("pwsh")
        if not ps:
            raise RuntimeError("Printing is not available: PowerShell not found")

        def ps_sq(s: str) -> str:
            # Single-quote for PowerShell string literals: ' becomes ''.
            return "'" + str(s or "").replace("'", "''") + "'"

        tmp = None
        try:
            tmp = tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt", encoding="utf-8")
            tmp.write(text or "")
            tmp.flush()
            tmp.close()

            # Print N copies by repeating the pipeline (Out-Printer has no "copies" flag).
            file_lit = ps_sq(tmp.name)
            name_clause = f" -Name {ps_sq(printer)}" if printer else ""
            cmd = (
                f"for ($i=0; $i -lt {copies_i}; $i++) {{ "
                f"Get-Content -LiteralPath {file_lit} -Raw -Encoding UTF8 | Out-Printer{name_clause}; "
                f"}}"
            )
            subprocess.run([ps, "-NoProfile", "-Command", cmd], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
            return
        finally:
            try:
                if tmp and tmp.name and os.path.exists(tmp.name):
                    os.unlink(tmp.name)
            except Exception:
                pass

    # macOS/Linux: use CUPS `lp`.
    lp = shutil.which("lp")
    if not lp:
        raise RuntimeError("Printing is not available: 'lp' command not found")

    tmp = None
    try:
        tmp = tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt", encoding="utf-8")
        tmp.write(text or "")
        tmp.flush()
        tmp.close()

        cmd = [lp]
        if printer:
            cmd += ["-d", str(printer)]
        if copies_i != 1:
            cmd += ["-n", str(copies_i)]
        cmd.append(tmp.name)

        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=12)
    finally:
        try:
            if tmp and tmp.name and os.path.exists(tmp.name):
                os.unlink(tmp.name)
        except Exception:
            pass


def _print_pdf_to_printer(pdf_bytes: bytes, printer: Optional[str] = None, copies: int = 1):
    """
    Best-effort PDF printing for A4 invoices.
    - macOS/Linux: CUPS `lp` prints PDFs reliably.
    - Windows: prefer SumatraPDF if installed; otherwise fall back to PowerShell PrintTo.
    """
    try:
        copies_i = int(copies or 1)
    except Exception:
        copies_i = 1
    copies_i = max(1, min(10, copies_i))

    tmp = None
    try:
        tmp = tempfile.NamedTemporaryFile("wb", delete=False, suffix=".pdf")
        tmp.write(pdf_bytes or b"")
        tmp.flush()
        tmp.close()

        if sys.platform.startswith("win"):
            # Prefer SumatraPDF when available (more reliable than PrintTo).
            sumatra = shutil.which("SumatraPDF") or shutil.which("SumatraPDF.exe")
            if sumatra and printer:
                for _ in range(copies_i):
                    subprocess.run(
                        [sumatra, "-print-to", str(printer), "-silent", tmp.name],
                        check=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=60,
                    )
                return

            ps = shutil.which("powershell") or shutil.which("pwsh")
            if not ps:
                raise RuntimeError("Printing is not available: PowerShell not found")

            def ps_sq(s: str) -> str:
                return "'" + str(s or "").replace("'", "''") + "'"

            file_lit = ps_sq(tmp.name)
            # PrintTo requires a printer name; if not provided, try default by omitting PrintTo and using Print,
            # but that is even less reliable. We require an explicit printer on Windows for PDFs.
            if not printer:
                raise RuntimeError("PDF printing on Windows requires selecting a printer")
            prn_lit = ps_sq(printer)
            cmd = (
                f"for ($i=0; $i -lt {copies_i}; $i++) {{ "
                f"$p = Start-Process -FilePath {file_lit} -Verb PrintTo -ArgumentList {prn_lit} -PassThru; "
                f"Start-Sleep -Milliseconds 800; "
                f"try {{ $p.CloseMainWindow() | Out-Null }} catch {{}} "
                f"}}"
            )
            subprocess.run([ps, "-NoProfile", "-Command", cmd], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
            return

        # macOS/Linux: use CUPS `lp`.
        lp = shutil.which("lp")
        if not lp:
            raise RuntimeError("Printing is not available: 'lp' command not found")
        cmd = [lp]
        if printer:
            cmd += ["-d", str(printer)]
        if copies_i != 1:
            cmd += ["-n", str(copies_i)]
        cmd.append(tmp.name)
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    finally:
        try:
            if tmp and tmp.name and os.path.exists(tmp.name):
                os.unlink(tmp.name)
        except Exception:
            pass


def _get_outbox_event(event_id: str) -> Optional[dict]:
    event_id = (event_id or "").strip()
    if not event_id:
        return None
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT event_id, event_type, payload_json, created_at, status
            FROM pos_outbox_events
            WHERE event_id = ?
            LIMIT 1
            """,
            (event_id,),
        )
        r = cur.fetchone()
        if not r:
            return None
        try:
            payload = json.loads(r["payload_json"] or "{}")
        except Exception:
            payload = {}
        return {
            "event_id": r["event_id"],
            "event_type": r["event_type"],
            "payload": payload,
            "created_at": r["created_at"],
            "status": r["status"],
        }


def _require_print_base_url(cfg: dict) -> str:
    raw = str(cfg.get("print_base_url") or "").strip()
    if not raw:
        raise ValueError("missing print_base_url (Admin URL)")
    return raw.rstrip("/")


def _fetch_invoice_pdf(cfg: dict, invoice_id: str) -> bytes:
    """
    Fetch the A4 invoice PDF from the Admin app exports route using device headers.
    """
    base = _require_print_base_url(cfg)
    invoice_id = (invoice_id or "").strip()
    if not invoice_id:
        raise ValueError("missing invoice_id")

    url = f"{base}/exports/sales-invoices/{quote(invoice_id)}/pdf?inline=1"
    req = Request(url, headers={**device_headers(cfg), "Accept": "application/pdf"}, method="GET")
    with urlopen(req, timeout=30) as resp:
        return resp.read()


def _resolve_sales_invoice_from_event(cfg: dict, event_id: str) -> dict:
    """
    Ensure the event exists on the edge, process it now, and return invoice identifiers.
    Returns: {invoice_id, invoice_no, edge}
    """
    base = _require_api_base(cfg)
    company_id = (cfg.get("company_id") or "").strip()
    device_id = (cfg.get("device_id") or "").strip()
    if not company_id or not device_id or not (cfg.get("device_token") or "").strip():
        raise ValueError("missing device credentials")

    ev = _get_outbox_event(event_id)
    if not ev:
        raise ValueError("event not found in local outbox")

    # Ensure the edge has this event (idempotent).
    bundle = {
        "company_id": company_id,
        "device_id": device_id,
        "events": [
            {"event_id": ev["event_id"], "event_type": ev["event_type"], "payload": ev["payload"], "created_at": ev["created_at"]},
        ],
    }
    post_json(f"{base.rstrip('/')}/pos/outbox/submit", bundle, headers=device_headers(cfg))

    # Process it now (synchronous best-effort).
    res = post_json(f"{base.rstrip('/')}/pos/outbox/process-one", {"event_id": ev["event_id"]}, headers=device_headers(cfg))
    inv_id = str(res.get("invoice_id") or "").strip()
    inv_no = str(res.get("invoice_no") or "").strip()
    if not inv_id:
        raise ValueError("event processed but invoice_id was not returned")
    return {"invoice_id": inv_id, "invoice_no": (inv_no or None), "edge": res}


def _compute_totals(
    lines,
    vat_rate: float,
    exchange_rate: float,
    default_tax_code_id: Optional[str] = None,
    vat_codes: Optional[dict] = None,
):
    base_usd = 0.0
    base_lbp = 0.0
    tax_lbp = 0.0

    has_vat_codes = isinstance(vat_codes, dict) and len(vat_codes) > 0
    for ln in lines or []:
        line_usd = float(ln.get("line_total_usd") or 0)
        line_lbp = float(ln.get("line_total_lbp") or 0)
        if line_lbp == 0 and exchange_rate:
            line_lbp = line_usd * exchange_rate
        base_usd += line_usd
        base_lbp += line_lbp

        if has_vat_codes:
            tcid = (ln.get("tax_code_id") or default_tax_code_id or None)
            rate = float(vat_codes.get(str(tcid), 0) or 0) if tcid else 0.0
            # Legacy fallback: if the default VAT code exists but isn't in the map, keep single-rate behavior.
            if rate == 0.0 and vat_rate and tcid and default_tax_code_id and str(tcid) == str(default_tax_code_id):
                rate = float(vat_rate or 0)
            tax_lbp += line_lbp * rate

    if not has_vat_codes:
        tax_lbp = base_lbp * float(vat_rate or 0)

    tax_usd = (tax_lbp / exchange_rate) if exchange_rate else 0.0
    return {
        "base_usd": base_usd,
        "base_lbp": base_lbp,
        "tax_usd": tax_usd,
        "tax_lbp": tax_lbp,
        "total_usd": base_usd + tax_usd,
        "total_lbp": base_lbp + tax_lbp,
    }


def verify_cashier_pin(pin: str):
    pin = (pin or "").strip()
    if not pin:
        return None
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, pin_hash
            FROM local_cashiers_cache
            WHERE is_active = 1
            ORDER BY updated_at DESC
            """
        )
        rows = cur.fetchall()
        for r in rows:
            ph = (r["pin_hash"] or "").encode("utf-8")
            try:
                if bcrypt.checkpw(pin.encode("utf-8"), ph):
                    return {"id": r["id"], "name": r["name"]}
            except Exception:
                # Bad hash in cache; skip it.
                continue
    return None


def verify_cashier_pin_online(pin: str, cfg: dict):
    """
    Best-effort online PIN verification.
    - Used as a fallback when the local cashier cache is empty/outdated.
    - If online verification succeeds, refresh the local cashiers cache so
      subsequent logins work fully offline.
    Returns: cashier dict on success, None on failure.
    """
    pin = (pin or "").strip()
    if not pin:
        return None
    if not (cfg.get("device_id") and cfg.get("device_token")):
        return None
    try:
        base = _require_api_base(cfg)
    except Exception:
        base = ""
    if not base:
        return None
    try:
        res = post_json(f"{base}/pos/cashiers/verify", {"pin": pin}, headers=device_headers(cfg))
        cashier = (res or {}).get("cashier") or None
        if not cashier:
            return None
        # Refresh cache so we can verify offline next time.
        try:
            cashiers = fetch_json(f"{base}/pos/cashiers/catalog", headers=device_headers(cfg))
            upsert_cashiers(cashiers.get("cashiers", []))
        except URLError:
            pass
        return {"id": cashier.get("id"), "name": cashier.get("name")}
    except URLError:
        return None


def upsert_catalog(items):
    with db_connect() as conn:
        cur = conn.cursor()
        for it in items:
            updated_at = it.get("changed_at") or it.get("updated_at") or datetime.utcnow().isoformat()
            cur.execute(
                """
                INSERT INTO local_items_cache
                  (id, sku, barcode, name, unit_of_measure, tax_code_id,
                   is_active, category_id, brand, short_name, description,
                   track_batches, track_expiry, default_shelf_life_days, min_shelf_life_days_for_sale, expiry_warning_days,
                   updated_at)
                VALUES
                  (?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?,
                   ?)
                ON CONFLICT(id) DO UPDATE SET
                  sku=excluded.sku,
                  barcode=excluded.barcode,
                  name=excluded.name,
                  unit_of_measure=excluded.unit_of_measure,
                  tax_code_id=excluded.tax_code_id,
                  is_active=excluded.is_active,
                  category_id=excluded.category_id,
                  brand=excluded.brand,
                  short_name=excluded.short_name,
                  description=excluded.description,
                  track_batches=excluded.track_batches,
                  track_expiry=excluded.track_expiry,
                  default_shelf_life_days=excluded.default_shelf_life_days,
                  min_shelf_life_days_for_sale=excluded.min_shelf_life_days_for_sale,
                  expiry_warning_days=excluded.expiry_warning_days,
                  updated_at=excluded.updated_at
                """,
                (
                    it.get('id'),
                    it.get('sku'),
                    it.get('barcode'),
                    it.get('name'),
                    it.get('unit_of_measure'),
                    it.get("tax_code_id"),
                    1 if it.get("is_active", True) else 0,
                    it.get("category_id"),
                    it.get("brand"),
                    it.get("short_name"),
                    it.get("description"),
                    1 if it.get("track_batches") else 0,
                    1 if it.get("track_expiry") else 0,
                    it.get("default_shelf_life_days"),
                    it.get("min_shelf_life_days_for_sale"),
                    it.get("expiry_warning_days"),
                    updated_at,
                ),
            )

            # Keep item barcodes in sync.
            cur.execute("DELETE FROM local_item_barcodes_cache WHERE item_id = ?", (it.get("id"),))
            # Multi-barcodes / pack factors
            for b in (it.get("barcodes") or []):
                cur.execute(
                    """
                    INSERT INTO local_item_barcodes_cache (id, item_id, barcode, qty_factor, uom_code, label, is_primary, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      item_id=excluded.item_id,
                      barcode=excluded.barcode,
                      qty_factor=excluded.qty_factor,
                      uom_code=excluded.uom_code,
                      label=excluded.label,
                      is_primary=excluded.is_primary,
                      updated_at=excluded.updated_at
                    """,
                    (
                        b.get("id") or f"bc-{it.get('id')}-{b.get('barcode')}",
                        it.get("id"),
                        b.get("barcode"),
                        float(b.get("qty_factor") or 1),
                        b.get("uom_code"),
                        b.get("label"),
                        1 if b.get("is_primary") else 0,
                        datetime.utcnow().isoformat(),
                    ),
                )
            cur.execute(
                """
                INSERT INTO local_prices_cache (id, item_id, price_usd, price_lbp, effective_from, effective_to)
                VALUES (?, ?, ?, ?, ?, NULL)
                ON CONFLICT(id) DO UPDATE SET
                  item_id=excluded.item_id,
                  price_usd=excluded.price_usd,
                  price_lbp=excluded.price_lbp,
                  effective_from=excluded.effective_from,
                  effective_to=excluded.effective_to
                """,
                (
                    f"price-current-{it.get('id')}",
                    it.get('id'),
                    it.get('price_usd') or 0,
                    it.get('price_lbp') or 0,
                    datetime.utcnow().date().isoformat(),
                ),
            )
        conn.commit()


def upsert_categories(categories):
    with db_connect() as conn:
        cur = conn.cursor()
        for c in categories or []:
            updated_at = c.get("changed_at") or c.get("updated_at") or datetime.utcnow().isoformat()
            cur.execute(
                """
                INSERT INTO local_item_categories_cache (id, name, parent_id, is_active, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name=excluded.name,
                  parent_id=excluded.parent_id,
                  is_active=excluded.is_active,
                  updated_at=excluded.updated_at
                """,
                (
                    c.get("id"),
                    c.get("name"),
                    c.get("parent_id"),
                    1 if c.get("is_active", True) else 0,
                    updated_at,
                ),
            )
        conn.commit()


def add_outbox_event(event_type, payload):
    # Must be UUID to match Postgres `pos_events_outbox.id` type.
    event_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()
    with db_connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO pos_outbox_events (event_id, event_type, payload_json, created_at, status)
            VALUES (?, ?, ?, ?, 'pending')
            """,
            (event_id, event_type, json.dumps(payload), created_at),
        )
        conn.commit()
    return event_id


def list_outbox():
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT event_id, event_type, created_at, status
            FROM pos_outbox_events
            WHERE status = 'pending'
            ORDER BY created_at
            """
        )
        return [dict(r) for r in cur.fetchall()]


def mark_outbox_sent(event_ids):
    with db_connect() as conn:
        cur = conn.cursor()
        for eid in event_ids:
            cur.execute(
                "UPDATE pos_outbox_events SET status='acked' WHERE event_id = ?",
                (eid,),
            )
        conn.commit()


def build_sale_payload(cart, config, pricing_currency, exchange_rate, customer_id, payment_method, shift_id, cashier_id):
    lines = []
    base_usd = 0
    base_lbp = 0
    for item in cart:
        # Robust UOM-aware payload:
        # - qty is base qty (used for inventory/costing)
        # - qty_entered/uom/qty_factor persist the cashier's scan/entry
        qty = float(item.get("qty") or 0)
        qty_factor = float(item.get("qty_factor") or 1) or 1.0
        if qty_factor <= 0:
            qty_factor = 1.0
        qty_entered = item.get("qty_entered")
        qty_entered = float(qty_entered) if qty_entered is not None else ((qty / qty_factor) if qty_factor else qty)
        uom = (item.get("uom") or item.get("uom_code") or item.get("unit_of_measure") or None)

        unit_price_usd = float(item.get('price_usd', 0) or 0)
        unit_price_lbp = float(item.get('price_lbp', 0) or 0)

        # Optional commercial metadata (promos/discounts). Preserve best-effort.
        pre_usd = float(item.get("pre_discount_unit_price_usd") or 0)
        pre_lbp = float(item.get("pre_discount_unit_price_lbp") or 0)
        disc_pct = float(item.get("discount_pct") or 0)
        disc_usd = float(item.get("discount_amount_usd") or 0)
        disc_lbp = float(item.get("discount_amount_lbp") or 0)
        applied_promotion_id = item.get("applied_promotion_id") or None
        applied_promotion_item_id = item.get("applied_promotion_item_id") or None

        line_total_usd = unit_price_usd * qty
        line_total_lbp = unit_price_lbp * qty
        if line_total_lbp == 0 and exchange_rate:
            line_total_lbp = line_total_usd * exchange_rate
        if line_total_usd == 0 and exchange_rate:
            line_total_usd = line_total_lbp / exchange_rate
        base_usd += line_total_usd
        base_lbp += line_total_lbp
        lines.append({
            'item_id': item['id'],
            'tax_code_id': (item.get('tax_code_id') or None),
            'qty': qty,
            'uom': uom,
            'qty_factor': qty_factor,
            'qty_entered': qty_entered,
            'unit_price_usd': unit_price_usd,
            'unit_price_lbp': unit_price_lbp,
            'unit_price_entered_usd': unit_price_usd * qty_factor,
            'unit_price_entered_lbp': unit_price_lbp * qty_factor,
            'pre_discount_unit_price_usd': pre_usd,
            'pre_discount_unit_price_lbp': pre_lbp,
            'discount_pct': disc_pct,
            'discount_amount_usd': disc_usd,
            'discount_amount_lbp': disc_lbp,
            'applied_promotion_id': applied_promotion_id,
            'applied_promotion_item_id': applied_promotion_item_id,
            'line_total_usd': line_total_usd,
            'line_total_lbp': line_total_lbp,
            'unit_cost_usd': 0,
            'unit_cost_lbp': 0,
            'batch_no': item.get('batch_no') or None,
            'expiry_date': item.get('expiry_date') or None
        })

    tax_block = None
    tax_breakdown = []
    tax_usd = 0.0
    tax_lbp = 0.0
    default_tax_code_id = (config.get('tax_code_id') or None)
    vat_rate = float(config.get('vat_rate') or 0)
    vat_codes = config.get('vat_codes') if isinstance(config.get('vat_codes'), dict) else {}
    has_vat_codes = isinstance(vat_codes, dict) and len(vat_codes) > 0
    if default_tax_code_id and (vat_rate or has_vat_codes):
        base_by = {}
        for ln in lines:
            tcid = (ln.get("tax_code_id") or default_tax_code_id or None)
            if not tcid:
                continue
            # If we have a VAT-code map, treat codes not in it as non-VAT (0%).
            if has_vat_codes and str(tcid) not in vat_codes and str(tcid) != str(default_tax_code_id):
                continue
            if str(tcid) not in base_by:
                base_by[str(tcid)] = {"base_usd": 0.0, "base_lbp": 0.0}
            base_by[str(tcid)]["base_usd"] += float(ln.get("line_total_usd") or 0)
            base_by[str(tcid)]["base_lbp"] += float(ln.get("line_total_lbp") or 0)

        for tcid, b in base_by.items():
            rate = float(vat_codes.get(str(tcid), 0) or 0) if has_vat_codes else vat_rate
            if rate == 0.0 and vat_rate and str(tcid) == str(default_tax_code_id):
                rate = vat_rate
            t_lbp = float(b["base_lbp"] or 0) * rate
            t_usd = (t_lbp / exchange_rate) if exchange_rate else 0.0
            tax_breakdown.append(
                {
                    "tax_code_id": tcid,
                    "base_usd": float(b["base_usd"] or 0),
                    "base_lbp": float(b["base_lbp"] or 0),
                    "tax_usd": float(t_usd or 0),
                    "tax_lbp": float(t_lbp or 0),
                    "tax_date": datetime.utcnow().date().isoformat(),
                }
            )
            tax_usd += t_usd
            tax_lbp += t_lbp

        tax_block = {
            'tax_code_id': default_tax_code_id,
            'base_usd': base_usd,
            'base_lbp': base_lbp,
            'tax_usd': tax_usd,
            'tax_lbp': tax_lbp,
            'tax_date': datetime.utcnow().date().isoformat()
        }

    total_usd = base_usd + tax_usd
    total_lbp = base_lbp + tax_lbp

    payments = []
    if payment_method == 'credit':
        payments.append({'method': 'credit', 'amount_usd': 0, 'amount_lbp': 0})
    else:
        # Store both USD + LBP equivalents for dual-ledger balancing.
        payments.append({'method': payment_method or 'cash', 'amount_usd': total_usd, 'amount_lbp': total_lbp})

    loyalty_rate = float(config.get('loyalty_rate') or 0)
    loyalty_points = base_usd * loyalty_rate if loyalty_rate > 0 else 0

    return {
        'invoice_no': None,
        'exchange_rate': exchange_rate,
        'pricing_currency': pricing_currency,
        'settlement_currency': pricing_currency,
        'customer_id': customer_id,
        'warehouse_id': config.get('warehouse_id'),
        'shift_id': shift_id,
        'cashier_id': cashier_id,
        'lines': lines,
        'tax': tax_block,
        'tax_breakdown': tax_breakdown,
        'payments': payments,
        'loyalty_points': loyalty_points
    }

def build_return_payload(cart, config, pricing_currency, exchange_rate, invoice_id, refund_method, shift_id, cashier_id):
    lines = []
    base_usd = 0
    base_lbp = 0
    for item in cart:
        qty = float(item.get("qty") or 0)
        qty_factor = float(item.get("qty_factor") or 1) or 1.0
        if qty_factor <= 0:
            qty_factor = 1.0
        qty_entered = item.get("qty_entered")
        qty_entered = float(qty_entered) if qty_entered is not None else ((qty / qty_factor) if qty_factor else qty)
        uom = (item.get("uom") or item.get("uom_code") or item.get("unit_of_measure") or None)

        unit_price_usd = float(item.get('price_usd', 0) or 0)
        unit_price_lbp = float(item.get('price_lbp', 0) or 0)

        pre_usd = float(item.get("pre_discount_unit_price_usd") or 0)
        pre_lbp = float(item.get("pre_discount_unit_price_lbp") or 0)
        disc_pct = float(item.get("discount_pct") or 0)
        disc_usd = float(item.get("discount_amount_usd") or 0)
        disc_lbp = float(item.get("discount_amount_lbp") or 0)
        applied_promotion_id = item.get("applied_promotion_id") or None
        applied_promotion_item_id = item.get("applied_promotion_item_id") or None

        line_total_usd = unit_price_usd * qty
        line_total_lbp = unit_price_lbp * qty
        if line_total_lbp == 0 and exchange_rate:
            line_total_lbp = line_total_usd * exchange_rate
        if line_total_usd == 0 and exchange_rate:
            line_total_usd = line_total_lbp / exchange_rate
        base_usd += line_total_usd
        base_lbp += line_total_lbp
        lines.append({
            'item_id': item['id'],
            'tax_code_id': (item.get('tax_code_id') or None),
            'qty': qty,
            'uom': uom,
            'qty_factor': qty_factor,
            'qty_entered': qty_entered,
            'unit_price_usd': unit_price_usd,
            'unit_price_lbp': unit_price_lbp,
            'unit_price_entered_usd': unit_price_usd * qty_factor,
            'unit_price_entered_lbp': unit_price_lbp * qty_factor,
            'pre_discount_unit_price_usd': pre_usd,
            'pre_discount_unit_price_lbp': pre_lbp,
            'discount_pct': disc_pct,
            'discount_amount_usd': disc_usd,
            'discount_amount_lbp': disc_lbp,
            'applied_promotion_id': applied_promotion_id,
            'applied_promotion_item_id': applied_promotion_item_id,
            'line_total_usd': line_total_usd,
            'line_total_lbp': line_total_lbp,
            'unit_cost_usd': 0,
            'unit_cost_lbp': 0,
            'batch_no': item.get('batch_no') or None,
            'expiry_date': item.get('expiry_date') or None
        })

    tax_block = None
    tax_breakdown = []
    tax_usd = 0.0
    tax_lbp = 0.0
    default_tax_code_id = (config.get('tax_code_id') or None)
    vat_rate = float(config.get('vat_rate') or 0)
    vat_codes = config.get('vat_codes') if isinstance(config.get('vat_codes'), dict) else {}
    has_vat_codes = isinstance(vat_codes, dict) and len(vat_codes) > 0
    if default_tax_code_id and (vat_rate or has_vat_codes):
        base_by = {}
        for ln in lines:
            tcid = (ln.get("tax_code_id") or default_tax_code_id or None)
            if not tcid:
                continue
            if has_vat_codes and str(tcid) not in vat_codes and str(tcid) != str(default_tax_code_id):
                continue
            if str(tcid) not in base_by:
                base_by[str(tcid)] = {"base_usd": 0.0, "base_lbp": 0.0}
            base_by[str(tcid)]["base_usd"] += float(ln.get("line_total_usd") or 0)
            base_by[str(tcid)]["base_lbp"] += float(ln.get("line_total_lbp") or 0)

        for tcid, b in base_by.items():
            rate = float(vat_codes.get(str(tcid), 0) or 0) if has_vat_codes else vat_rate
            if rate == 0.0 and vat_rate and str(tcid) == str(default_tax_code_id):
                rate = vat_rate
            t_lbp = float(b["base_lbp"] or 0) * rate
            t_usd = (t_lbp / exchange_rate) if exchange_rate else 0.0
            tax_breakdown.append(
                {
                    "tax_code_id": tcid,
                    "base_usd": float(b["base_usd"] or 0),
                    "base_lbp": float(b["base_lbp"] or 0),
                    "tax_usd": float(t_usd or 0),
                    "tax_lbp": float(t_lbp or 0),
                    "tax_date": datetime.utcnow().date().isoformat(),
                }
            )
            tax_usd += t_usd
            tax_lbp += t_lbp

        tax_block = {
            'tax_code_id': default_tax_code_id,
            'base_usd': base_usd,
            'base_lbp': base_lbp,
            'tax_usd': tax_usd,
            'tax_lbp': tax_lbp,
            'tax_date': datetime.utcnow().date().isoformat()
        }

    return {
        'return_no': None,
        'invoice_id': invoice_id,
        'exchange_rate': exchange_rate,
        'pricing_currency': pricing_currency,
        'settlement_currency': pricing_currency,
        'warehouse_id': config.get('warehouse_id'),
        'shift_id': shift_id,
        'cashier_id': cashier_id,
        'refund_method': refund_method or 'cash',
        'lines': lines,
        'tax': tax_block,
        'tax_breakdown': tax_breakdown,
    }


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        if _reject_if_disallowed_origin(self):
            return
        self.send_response(200)
        _maybe_send_cors_headers(self)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/receipt/last":
            # Never serve printable receipts over LAN; keep this loopback-only.
            client_ip = (self.client_address[0] if self.client_address else "")
            if not _is_loopback(client_ip):
                text_response(self, "Forbidden", status=403)
                return
            if _reject_if_disallowed_origin(self):
                return
            row = get_last_receipt()
            text_response(self, _receipt_html(row), status=200, content_type="text/html")
            return
        if parsed.path.startswith('/api/'):
            if _reject_if_disallowed_origin(self):
                return
            self.handle_api_get(parsed)
            return
        path = parsed.path
        if path == '/':
            path = '/index.html'
        # Backward compatibility: older launchers and runbooks referenced /unified.html.
        # The Unified POS is now the main Svelte UI served at / (index.html).
        if path == "/unified.html":
            path = "/index.html"
        # Prevent path traversal outside UI_PATH.
        ui_root = os.path.realpath(_served_ui_root())
        requested = os.path.realpath(os.path.join(ui_root, path.lstrip('/')))
        if requested != ui_root and not requested.startswith(ui_root + os.sep):
            text_response(self, "Forbidden", status=403)
            return
        # SPA fallback: when using the Vite dist build, route unknown paths to index.html.
        # This keeps deep-links and legacy paths working without special casing each one.
        if os.path.isdir(ui_root) and os.path.basename(ui_root) == "dist":
            if (not os.path.exists(requested)) and (not os.path.splitext(path)[1]):
                requested = os.path.realpath(os.path.join(ui_root, "index.html"))
        file_response(self, requested)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api/'):
            if _reject_if_disallowed_origin(self):
                return
            self.handle_api_post(parsed)
            return
        text_response(self, 'Not found', status=404)

    def read_json(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return {}
        # Best-effort body size cap to avoid trivial memory DoS.
        max_len = int(load_config().get("max_json_body_bytes") or 1024 * 1024)
        if length < 0 or length > max_len:
            raise _JsonBodyError(status=413, payload={"error": "payload_too_large"})
        raw = self.rfile.read(length).decode('utf-8', errors='replace')
        try:
            obj = json.loads(raw)
        except Exception:
            raise _JsonBodyError(status=400, payload={"error": "invalid_json"})
        if obj is None:
            return {}
        if not isinstance(obj, dict):
            raise _JsonBodyError(status=400, payload={"error": "invalid_json", "hint": "JSON object required"})
        return obj

    def handle_api_get(self, parsed):
        client_ip = (self.client_address[0] if self.client_address else "")
        cfg = load_config()

        # Guard read endpoints when the agent is LAN-exposed (or explicitly required).
        # This prevents leaking sensitive data like device tokens/config to the local network.
        if parsed.path != "/api/health" and _admin_pin_required(client_ip, cfg):
            if not (cfg.get("admin_pin_hash") or "").strip():
                json_response(
                    self,
                    {
                        "error": "pos_auth_required",
                        "hint": "Set admin PIN (localhost): POST /api/admin/pin/set, then unlock with POST /api/auth/pin.",
                    },
                    status=503,
                )
                return
            token = (self.headers.get("X-POS-Session") or "").strip()
            if not _validate_admin_session(token):
                json_response(self, {"error": "pos_auth_required"}, status=401)
                return

        if parsed.path == '/api/health':
            json_response(self, {'ok': True})
            return
        if parsed.path == "/api/printers":
            json_response(self, list_system_printers())
            return
        if parsed.path == "/api/edge/status":
            st = edge_health(cfg, timeout_s=0.8)
            auth = edge_auth_check(cfg, timeout_s=1.2)
            json_response(
                self,
                {
                    "ok": True,
                    "mode": st.get("mode") or auth.get("mode") or None,
                    "active_base_url": st.get("active_base_url") or auth.get("active_base_url") or None,
                    "edge_api_base_url": st.get("edge_api_base_url") or None,
                    "cloud_api_base_url": st.get("cloud_api_base_url") or None,
                    "resolve_detail": st.get("detail") or auth.get("detail") or None,
                    "edge_ok": bool(st.get("ok")),
                    "edge_latency_ms": st.get("latency_ms"),
                    "edge_url": (st.get("url") or ""),
                    "edge_error": st.get("error"),
                    "edge_auth_ok": bool(auth.get("ok")),
                    "edge_auth_status": auth.get("status"),
                    "edge_auth_latency_ms": auth.get("latency_ms"),
                    "edge_auth_url": (auth.get("url") or ""),
                    "edge_auth_error": auth.get("error"),
                    "outbox_pending": count_outbox_pending(),
                },
            )
            return
        if parsed.path == '/api/config':
            json_response(self, _public_config(cfg))
            return
        if parsed.path == '/api/items':
            json_response(self, {'items': get_items()})
            return
        if parsed.path.startswith("/api/items/") and parsed.path.endswith("/batches"):
            # Proxy eligible batches from backend (best-effort; online-only).
            # Used by the POS UI to provide a pick/confirm flow for batch/expiry items.
            parts = parsed.path.strip("/").split("/")
            # ["api", "items", "{item_id}", "batches"]
            if len(parts) != 4:
                json_response(self, {"error": "not found"}, status=404)
                return
            item_id = parts[2]
            qs = parse_qs(parsed.query)
            warehouse_id = (qs.get("warehouse_id") or [""])[0].strip() or (cfg.get("warehouse_id") or "").strip()
            if not warehouse_id:
                json_response(self, {"error": "warehouse_id is required"}, status=400)
                return
            try:
                base = _require_api_base(cfg)
            except Exception:
                json_response(self, {"error": "missing api_base_url"}, status=400)
                return
            if not cfg.get("device_id") or not cfg.get("device_token"):
                json_response(self, {"error": "missing device_id or device_token"}, status=400)
                return
            try:
                headers = device_headers(cfg)
                url = f"{base}/pos/items/{quote(str(item_id))}/batches?warehouse_id={quote(str(warehouse_id))}"
                data = fetch_json(url, headers=headers)
                json_response(self, data)
            except URLError as ex:
                json_response(self, {"error": "offline", "detail": str(ex)}, status=502)
            return
        if parsed.path == '/api/barcodes':
            json_response(self, {'barcodes': get_barcodes()})
            return
        if parsed.path == '/api/cashiers':
            json_response(self, {'cashiers': get_cashiers()})
            return
        if parsed.path == "/api/promotions":
            json_response(self, {"promotions": get_promotions()})
            return
        if parsed.path == "/api/receipts/last":
            json_response(self, {"receipt": get_last_receipt()})
            return

        if parsed.path == '/api/customers':
            q = (parse_qs(parsed.query).get("query") or [""])[0]
            limit = (parse_qs(parsed.query).get("limit") or ["50"])[0]
            try:
                limit_i = int(limit)
            except Exception:
                limit_i = 50
            json_response(self, {'customers': get_customers(q, limit=limit_i)})
            return

        if parsed.path == '/api/customers/by-id':
            cid = (parse_qs(parsed.query).get("customer_id") or [""])[0]
            row = get_customer_by_id(cid)
            json_response(self, {'customer': row})
            return
        if parsed.path == '/api/outbox':
            json_response(self, {'outbox': list_outbox()})
            return
        json_response(self, {'error': 'not found'}, status=404)

    def handle_api_post(self, parsed):
        client_ip = (self.client_address[0] if self.client_address else "")
        try:
            return self._handle_api_post(parsed, client_ip)
        except _JsonBodyError as ex:
            json_response(self, ex.payload, status=ex.status)
            return

    def _handle_api_post(self, parsed, client_ip: str):

        # Local admin PIN setup (loopback-only).
        if parsed.path == "/api/admin/pin/set":
            if not _is_loopback(client_ip):
                json_response(self, {"error": "forbidden", "hint": "PIN setup is allowed only from localhost."}, status=403)
                return
            data = self.read_json()
            pin = (data.get("pin") or "").strip()
            cfg = load_config()
            try:
                _set_admin_pin(cfg, pin)
                json_response(self, {"ok": True})
            except Exception as ex:
                json_response(self, {"error": str(ex)}, status=400)
            return

        # Local admin unlock (returns session token for X-POS-Session header).
        if parsed.path == "/api/auth/pin":
            data = self.read_json()
            pin = (data.get("pin") or "").strip()
            cfg = load_config()
            if not (cfg.get("admin_pin_hash") or "").strip():
                json_response(
                    self,
                    {"error": "admin_pin_not_set", "hint": "Set a PIN via POST /api/admin/pin/set (localhost only)."},
                    status=400,
                )
                return
            if not _verify_admin_pin(cfg, pin):
                json_response(self, {"error": "invalid_pin"}, status=401)
                return
            sess = _create_admin_session(int(cfg.get("admin_session_hours") or 12))
            json_response(self, {"ok": True, "token": sess["token"], "expires_at": sess["expires_at"]})
            return

        # Guard mutating endpoints when the agent is LAN-exposed (or explicitly required).
        cfg = load_config()
        if _admin_pin_required(client_ip, cfg):
            if not (cfg.get("admin_pin_hash") or "").strip():
                json_response(
                    self,
                    {
                        "error": "pos_auth_required",
                        "hint": "Set admin PIN (localhost): POST /api/admin/pin/set, then unlock with POST /api/auth/pin.",
                    },
                    status=503,
                )
                return
            token = (self.headers.get("X-POS-Session") or "").strip()
            if not _validate_admin_session(token):
                json_response(self, {"error": "pos_auth_required"}, status=401)
                return

        if parsed.path == "/api/setup/login":
            data = self.read_json()
            api_base = _normalize_api_base_url(data.get("api_base_url"))
            email = str(data.get("email") or "").strip()
            password = str(data.get("password") or "")
            mfa_token = str(data.get("mfa_token") or "").strip()
            mfa_code = str(data.get("mfa_code") or "").strip()
            if not api_base:
                json_response(self, {"error": "api_base_url is required"}, status=400)
                return

            if mfa_token:
                if not mfa_code:
                    json_response(self, {"error": "mfa_code is required"}, status=400)
                    return
                auth_res, status, err = _setup_req_json_safe(
                    f"{api_base}/auth/mfa/verify",
                    method="POST",
                    payload={"mfa_token": mfa_token, "code": mfa_code},
                )
            else:
                if not email or not password:
                    json_response(self, {"error": "email and password are required"}, status=400)
                    return
                auth_res, status, err = _setup_req_json_safe(
                    f"{api_base}/auth/login",
                    method="POST",
                    payload={"email": email, "password": password},
                )

            if status:
                json_response(self, {"error": err or f"auth request failed ({status})"}, status=status)
                return

            if auth_res.get("mfa_required"):
                json_response(
                    self,
                    {
                        "ok": True,
                        "mfa_required": True,
                        "mfa_token": auth_res.get("mfa_token"),
                    },
                )
                return

            token = str(auth_res.get("token") or "").strip()
            if not token:
                json_response(self, {"error": "no token returned by auth service"}, status=502)
                return

            companies_res, c_status, c_err = _setup_req_json_safe(
                f"{api_base}/companies",
                method="GET",
                headers={"Authorization": f"Bearer {token}"},
            )
            if c_status:
                json_response(self, {"error": c_err or f"companies request failed ({c_status})"}, status=c_status)
                return

            json_response(
                self,
                {
                    "ok": True,
                    "mfa_required": False,
                    "token": token,
                    "companies": list(companies_res.get("companies") or []),
                    "active_company_id": auth_res.get("active_company_id"),
                },
            )
            return

        if parsed.path == "/api/setup/branches":
            data = self.read_json()
            api_base = _normalize_api_base_url(data.get("api_base_url"))
            token = str(data.get("token") or "").strip()
            company_id = str(data.get("company_id") or "").strip()
            if not api_base:
                json_response(self, {"error": "api_base_url is required"}, status=400)
                return
            if not token:
                json_response(self, {"error": "token is required"}, status=400)
                return
            if not company_id:
                json_response(self, {"error": "company_id is required"}, status=400)
                return

            headers = {
                "Authorization": f"Bearer {token}",
                "X-Company-Id": company_id,
            }
            res, status, err = _setup_req_json_safe(
                f"{api_base}/branches",
                method="GET",
                headers=headers,
            )
            if status:
                # Some roles may not have config:read; treat as non-fatal for quick setup.
                if status in (401, 403):
                    json_response(
                        self,
                        {
                            "ok": True,
                            "branches": [],
                            "warning": "Branches unavailable for this account; leave Branch empty or enter one in Advanced settings.",
                        },
                    )
                    return
                json_response(self, {"error": err or f"branches request failed ({status})"}, status=status)
                return

            json_response(self, {"ok": True, "branches": list(res.get("branches") or [])})
            return

        if parsed.path == "/api/setup/devices":
            data = self.read_json()
            api_base = _normalize_api_base_url(data.get("api_base_url"))
            token = str(data.get("token") or "").strip()
            company_id = str(data.get("company_id") or "").strip()
            if not api_base:
                json_response(self, {"error": "api_base_url is required"}, status=400)
                return
            if not token:
                json_response(self, {"error": "token is required"}, status=400)
                return
            if not company_id:
                json_response(self, {"error": "company_id is required"}, status=400)
                return

            headers = {
                "Authorization": f"Bearer {token}",
                "X-Company-Id": company_id,
            }

            # Best effort: align active company for the setup session.
            _setup_req_json_safe(
                f"{api_base}/auth/select-company",
                method="POST",
                payload={"company_id": company_id},
                headers={"Authorization": f"Bearer {token}"},
            )

            res, status, err = _setup_req_json_safe(
                f"{api_base}/pos/devices",
                method="GET",
                headers=headers,
            )
            if status:
                # Keep quick setup usable even when listing is denied; user can still type a device code.
                if status in (401, 403):
                    json_response(
                        self,
                        {
                            "ok": True,
                            "devices": [],
                            "warning": "Device list unavailable for this account; enter a device code manually.",
                        },
                    )
                    return
                json_response(self, {"error": err or f"devices request failed ({status})"}, status=status)
                return

            raw_devices = list(res.get("devices") or [])
            out_devices = []
            for d in raw_devices:
                code = str((d or {}).get("device_code") or "").strip()
                if not code:
                    continue
                out_devices.append(
                    {
                        "id": str((d or {}).get("id") or "").strip(),
                        "device_code": code,
                        "branch_id": str((d or {}).get("branch_id") or "").strip() or None,
                        "branch_name": str((d or {}).get("branch_name") or "").strip() or None,
                        "has_token": bool((d or {}).get("has_token")),
                    }
                )
            out_devices.sort(key=lambda x: str(x.get("device_code") or "").lower())
            json_response(self, {"ok": True, "devices": out_devices})
            return

        if parsed.path == "/api/setup/check-permissions":
            data = self.read_json()
            api_base = _normalize_api_base_url(data.get("api_base_url"))
            token = str(data.get("token") or "").strip()
            company_id = str(data.get("company_id") or "").strip()
            if not api_base:
                json_response(self, {"error": "api_base_url is required"}, status=400)
                return
            if not token:
                json_response(self, {"error": "token is required"}, status=400)
                return
            if not company_id:
                json_response(self, {"error": "company_id is required"}, status=400)
                return

            headers = {
                "Authorization": f"Bearer {token}",
                "X-Company-Id": company_id,
            }
            _perm_res, perm_status, perm_err = _setup_req_json_safe(
                f"{api_base}/pos/devices?limit=1",
                method="GET",
                headers=headers,
            )
            if perm_status:
                if perm_status in (401, 403):
                    json_response(
                        self,
                        {
                            "ok": True,
                            "company_id": company_id,
                            "has_pos_manage": False,
                            "error": perm_err or "permission denied",
                            "status_code": perm_status,
                        },
                    )
                    return
                json_response(self, {"error": perm_err or f"permission check failed ({perm_status})"}, status=perm_status)
                return

            json_response(
                self,
                {
                    "ok": True,
                    "company_id": company_id,
                    "has_pos_manage": True,
                },
            )
            return

        if parsed.path == "/api/setup/register-device":
            data = self.read_json()
            api_base = _normalize_api_base_url(data.get("api_base_url"))
            token = str(data.get("token") or "").strip()
            company_id = str(data.get("company_id") or "").strip()
            branch_id = str(data.get("branch_id") or "").strip()
            device_code = str(data.get("device_code") or "").strip()
            reset_token = bool(data.get("reset_token", True))
            if not api_base:
                json_response(self, {"error": "api_base_url is required"}, status=400)
                return
            if not token:
                json_response(self, {"error": "token is required"}, status=400)
                return
            if not company_id:
                json_response(self, {"error": "company_id is required"}, status=400)
                return
            if not device_code:
                json_response(self, {"error": "device_code is required"}, status=400)
                return

            params = {
                "company_id": company_id,
                "device_code": device_code,
                "reset_token": "true" if reset_token else "false",
            }
            if branch_id:
                params["branch_id"] = branch_id

            headers = {
                "Authorization": f"Bearer {token}",
                "X-Company-Id": company_id,
            }

            # Best effort: align active company on the session used for setup.
            _setup_req_json_safe(
                f"{api_base}/auth/select-company",
                method="POST",
                payload={"company_id": company_id},
                headers={"Authorization": f"Bearer {token}"},
            )

            reg_res, status, err = _setup_req_json_safe(
                f"{api_base}/pos/devices/register?{urlencode(params)}",
                method="POST",
                headers=headers,
            )
            if status:
                json_response(self, {"error": err or f"device registration failed ({status})"}, status=status)
                return

            device_id = str(reg_res.get("id") or "").strip()
            device_token = str(reg_res.get("token") or "").strip()
            if not device_id:
                json_response(self, {"error": "registration response missing device id"}, status=502)
                return
            if not device_token:
                json_response(
                    self,
                    {"error": "device exists but no token returned; enable token reset and retry"},
                    status=409,
                )
                return

            json_response(
                self,
                {
                    "ok": True,
                    "device_id": device_id,
                    "device_token": device_token,
                },
            )
            return

        if parsed.path == '/api/config':
            data = self.read_json()
            cfg.update(data)
            save_config(cfg)
            json_response(self, {'ok': True, 'config': cfg})
            return

        if parsed.path == "/api/receipts/print-last":
            # Best-effort local printing (no browser dialog). Useful for kiosk setups.
            data = self.read_json()
            cfg = load_config()
            printer = (str(data.get("printer") or "").strip() or str(cfg.get("receipt_printer") or "").strip() or None)
            copies = data.get("copies") if "copies" in data else cfg.get("receipt_print_copies")

            row = get_last_receipt()
            if not row:
                json_response(self, {"error": "no_receipt"}, status=404)
                return
            try:
                txt = _receipt_text(row)
                _print_text_to_printer(txt, printer=printer, copies=copies)
            except Exception as ex:
                json_response(self, {"error": "print_failed", "detail": str(ex), "printer": printer}, status=502)
                return

            json_response(self, {"ok": True, "printer": printer, "copies": copies})
            return

        if parsed.path == "/api/printers/test":
            data = self.read_json()
            cfg = load_config()
            printer = (str(data.get("printer") or "").strip() or str(cfg.get("receipt_printer") or "").strip() or None)
            copies = data.get("copies") if "copies" in data else 1
            txt = "TEST PRINT\n\nIf you can read this, printer mapping works.\n\n"
            try:
                _print_text_to_printer(txt, printer=printer, copies=copies)
            except Exception as ex:
                json_response(self, {"error": "print_failed", "detail": str(ex), "printer": printer}, status=502)
                return
            json_response(self, {"ok": True, "printer": printer, "copies": copies})
            return

        if parsed.path == "/api/invoices/resolve-by-event":
            data = self.read_json()
            cfg = load_config()
            event_id = str(data.get("event_id") or "").strip()
            if not event_id:
                json_response(self, {"error": "event_id is required"}, status=400)
                return
            try:
                res = _resolve_sales_invoice_from_event(cfg, event_id)
            except Exception as ex:
                json_response(self, {"error": "resolve_failed", "detail": str(ex)}, status=502)
                return
            json_response(self, {"ok": True, "event_id": event_id, **res})
            return

        if parsed.path == "/api/invoices/print-by-event":
            data = self.read_json()
            cfg = load_config()
            event_id = str(data.get("event_id") or "").strip()
            if not event_id:
                json_response(self, {"error": "event_id is required"}, status=400)
                return

            printer = (str(data.get("printer") or "").strip() or str(cfg.get("invoice_printer") or "").strip() or None)
            copies = data.get("copies") if "copies" in data else cfg.get("invoice_print_copies")

            try:
                resolved = _resolve_sales_invoice_from_event(cfg, event_id)
                pdf = _fetch_invoice_pdf(cfg, resolved["invoice_id"])
                _print_pdf_to_printer(pdf, printer=printer, copies=copies)
            except Exception as ex:
                json_response(
                    self,
                    {"error": "print_failed", "detail": str(ex), "event_id": event_id, "printer": printer},
                    status=502,
                )
                return

            json_response(self, {"ok": True, "event_id": event_id, "printer": printer, "copies": copies, **resolved})
            return

        if parsed.path == "/api/customers/create":
            data = self.read_json()
            name = str(data.get("name") or "").strip()
            phone = str(data.get("phone") or "").strip()
            email = str(data.get("email") or "").strip()
            if not name:
                json_response(self, {"error": "name is required"}, status=400)
                return
            try:
                api_base = _require_api_base(cfg)
            except Exception:
                json_response(self, {"error": "missing api_base_url"}, status=400)
                return
            if not cfg.get("device_id") or not cfg.get("device_token"):
                json_response(self, {"error": "missing device_id or device_token"}, status=400)
                return
            payload = {
                "name": name,
                "phone": phone or None,
                "email": email or None,
                "party_type": "individual",
                "customer_type": "retail",
                "payment_terms_days": 0,
                "is_active": True,
            }
            res, status, err = _setup_req_json_safe(
                f"{api_base}/pos/customers",
                method="POST",
                payload=payload,
                headers=device_headers(cfg),
                timeout_s=10.0,
            )
            if status:
                json_response(self, {"error": err or f"customer create failed ({status})"}, status=status)
                return
            customer = (res or {}).get("customer") or None
            if not isinstance(customer, dict) or not customer.get("id"):
                json_response(self, {"error": "invalid customer response"}, status=502)
                return
            # Keep local customer cache hot so typeahead finds it immediately.
            try:
                upsert_customers([customer])
            except Exception:
                pass
            json_response(self, {"ok": True, "customer": customer})
            return

        if parsed.path == '/api/sale':
            data = self.read_json()
            cfg = load_config()
            cart = data.get('cart', [])
            if not cart:
                json_response(self, {'error': 'empty cart'}, status=400)
                return
            exchange_rate = data.get('exchange_rate') or cfg.get('exchange_rate') or 0
            pricing_currency = data.get('pricing_currency') or cfg.get('pricing_currency') or 'USD'
            customer_id = data.get('customer_id')
            payment_method = data.get('payment_method') or 'cash'
            pm = (payment_method or "cash").strip().lower()
            shift_id = data.get('shift_id') or cfg.get('shift_id') or None
            cashier_id = data.get('cashier_id') or cfg.get('cashier_id') or None
            payload = build_sale_payload(
                cart,
                cfg,
                pricing_currency,
                float(exchange_rate),
                customer_id,
                payment_method,
                shift_id,
                cashier_id,
            )
            # Optional: store printer hint on the backend invoice for audit.
            if (cfg.get("receipt_printer") or "").strip():
                payload["receipt_printer"] = str(cfg.get("receipt_printer")).strip()
            # Allow callers (e.g. unified pilot UI) to attach extra metadata.
            # The backend stores receipt_meta on the sales invoice for audit/review.
            if isinstance(data.get("receipt_meta"), (dict, list)):
                payload["receipt_meta"] = data.get("receipt_meta")
            if "skip_stock_moves" in data:
                payload["skip_stock_moves"] = bool(data.get("skip_stock_moves"))
            created_at = datetime.utcnow().isoformat()
            event_id = add_outbox_event('sale.completed', payload)

            # Higher-risk rule:
            # - Credit sales should only be allowed when the register can reach the edge AND the edge accepts the event.
            # Otherwise we risk printing a receipt for a sale that will later be rejected (credit limits, customer missing, etc).
            if pm == "credit":
                st = edge_health(cfg, timeout_s=0.8)
                if not st.get("ok"):
                    json_response(
                        self,
                        {"error": "edge_offline", "hint": "Credit is disabled when the edge server is unreachable."},
                        status=503,
                    )
                    return
                ok, res = submit_single_event(cfg, event_id, "sale.completed", payload, created_at)
                if not ok:
                    json_response(
                        self,
                        {
                            "error": "edge_rejected",
                            "hint": "Credit requires edge acceptance. Try again when edge is reachable, or use cash/card.",
                            "detail": res,
                        },
                        status=409,
                    )
                    return
                mark_outbox_sent([event_id])

            # Persist a printable receipt snapshot locally (offline-friendly).
            items_map = {i["id"]: i for i in (get_items() or [])}
            cart_map = {str(i.get("id")): i for i in (cart or []) if i.get("id")}
            cashier_map = {c["id"]: c for c in (get_cashiers() or [])}
            receipt_lines = []
            for ln in payload.get("lines") or []:
                info = items_map.get(ln.get("item_id")) or cart_map.get(str(ln.get("item_id"))) or {}
                receipt_lines.append(
                    {
                        "item_id": ln.get("item_id"),
                        "sku": info.get("sku"),
                        "name": info.get("name"),
                        "tax_code_id": info.get("tax_code_id"),
                        "qty": ln.get("qty"),
                        "uom": ln.get("uom"),
                        "qty_factor": ln.get("qty_factor"),
                        "qty_entered": ln.get("qty_entered"),
                        "unit_price_usd": ln.get("unit_price_usd"),
                        "unit_price_lbp": ln.get("unit_price_lbp"),
                        "unit_price_entered_usd": ln.get("unit_price_entered_usd"),
                        "unit_price_entered_lbp": ln.get("unit_price_entered_lbp"),
                        "line_total_usd": ln.get("line_total_usd"),
                        "line_total_lbp": ln.get("line_total_lbp"),
                    }
                )
            receipt = {
                "created_at": created_at,
                "event_id": event_id,
                "company_id": cfg.get("company_id"),
                "device_id": cfg.get("device_id"),
                "shift_id": shift_id,
                "cashier": {"id": cashier_id, "name": cashier_map.get(cashier_id, {}).get("name") if cashier_id else None},
                "customer_id": customer_id,
                "payment_method": payment_method,
                "pricing_currency": pricing_currency,
                "exchange_rate": float(exchange_rate or 0),
                "vat_rate": float(cfg.get("vat_rate") or 0),
                "lines": receipt_lines,
                "totals": _compute_totals(
                    receipt_lines,
                    float(cfg.get("vat_rate") or 0),
                    float(exchange_rate or 0),
                    default_tax_code_id=(cfg.get("tax_code_id") or None),
                    vat_codes=(cfg.get("vat_codes") if isinstance(cfg.get("vat_codes"), dict) else None),
                ),
            }
            save_receipt("sale", receipt)
            json_response(self, {'event_id': event_id, "edge_accepted": True if pm == "credit" else None})
            return

        if parsed.path == '/api/return':
            data = self.read_json()
            cfg = load_config()
            cart = data.get('cart', [])
            if not cart:
                json_response(self, {'error': 'empty cart'}, status=400)
                return
            exchange_rate = data.get('exchange_rate') or cfg.get('exchange_rate') or 0
            pricing_currency = data.get('pricing_currency') or cfg.get('pricing_currency') or 'USD'
            invoice_id = data.get('invoice_id') or None
            refund_method = data.get('refund_method') or data.get('payment_method') or 'cash'
            shift_id = data.get('shift_id') or cfg.get('shift_id') or None
            cashier_id = data.get('cashier_id') or cfg.get('cashier_id') or None
            payload = build_return_payload(
                cart,
                cfg,
                pricing_currency,
                float(exchange_rate),
                invoice_id,
                refund_method,
                shift_id,
                cashier_id,
            )
            # Optional: store printer hint on the backend invoice for audit.
            if (cfg.get("receipt_printer") or "").strip():
                payload["receipt_printer"] = str(cfg.get("receipt_printer")).strip()
            if isinstance(data.get("receipt_meta"), (dict, list)):
                payload["receipt_meta"] = data.get("receipt_meta")
            if "skip_stock_moves" in data:
                payload["skip_stock_moves"] = bool(data.get("skip_stock_moves"))
            created_at = datetime.utcnow().isoformat()
            event_id = add_outbox_event('sale.returned', payload)

            # Returns are also high-risk: do not print a refund receipt unless the edge accepts it.
            st = edge_health(cfg, timeout_s=0.8)
            if not st.get("ok"):
                json_response(
                    self,
                    {"error": "edge_offline", "hint": "Returns are disabled when the edge server is unreachable."},
                    status=503,
                )
                return
            ok, res = submit_single_event(cfg, event_id, "sale.returned", payload, created_at)
            if not ok:
                json_response(
                    self,
                    {
                        "error": "edge_rejected",
                        "hint": "Return requires edge acceptance. Reconnect to edge and try again.",
                        "detail": res,
                    },
                    status=409,
                )
                return
            mark_outbox_sent([event_id])
            items_map = {i["id"]: i for i in (get_items() or [])}
            cart_map = {str(i.get("id")): i for i in (cart or []) if i.get("id")}
            cashier_map = {c["id"]: c for c in (get_cashiers() or [])}
            receipt_lines = []
            for ln in payload.get("lines") or []:
                info = items_map.get(ln.get("item_id")) or cart_map.get(str(ln.get("item_id"))) or {}
                receipt_lines.append(
                    {
                        "item_id": ln.get("item_id"),
                        "sku": info.get("sku"),
                        "name": info.get("name"),
                        "tax_code_id": info.get("tax_code_id"),
                        "qty": ln.get("qty"),
                        "uom": ln.get("uom"),
                        "qty_factor": ln.get("qty_factor"),
                        "qty_entered": ln.get("qty_entered"),
                        "unit_price_usd": ln.get("unit_price_usd"),
                        "unit_price_lbp": ln.get("unit_price_lbp"),
                        "unit_price_entered_usd": ln.get("unit_price_entered_usd"),
                        "unit_price_entered_lbp": ln.get("unit_price_entered_lbp"),
                        "line_total_usd": ln.get("line_total_usd"),
                        "line_total_lbp": ln.get("line_total_lbp"),
                    }
                )
            receipt = {
                "created_at": created_at,
                "event_id": event_id,
                "company_id": cfg.get("company_id"),
                "device_id": cfg.get("device_id"),
                "shift_id": shift_id,
                "cashier": {"id": cashier_id, "name": cashier_map.get(cashier_id, {}).get("name") if cashier_id else None},
                "customer_id": None,
                "payment_method": refund_method,
                "pricing_currency": pricing_currency,
                "exchange_rate": float(exchange_rate or 0),
                "vat_rate": float(cfg.get("vat_rate") or 0),
                "lines": receipt_lines,
                "totals": _compute_totals(
                    receipt_lines,
                    float(cfg.get("vat_rate") or 0),
                    float(exchange_rate or 0),
                    default_tax_code_id=(cfg.get("tax_code_id") or None),
                    vat_codes=(cfg.get("vat_codes") if isinstance(cfg.get("vat_codes"), dict) else None),
                ),
                "invoice_id": invoice_id,
            }
            save_receipt("return", receipt)
            json_response(self, {'event_id': event_id, "edge_accepted": True})
            return

        if parsed.path == '/api/cashiers/login':
            data = self.read_json()
            pin = (data.get("pin") or "").strip()
            cfg = load_config()
            cashier = verify_cashier_pin(pin)
            if not cashier:
                # Fallback: if the local cache is empty/outdated, try verifying online.
                cashier = verify_cashier_pin_online(pin, cfg)
            if not cashier:
                cached = get_cashiers() or []
                if not cached:
                    json_response(
                        self,
                        {
                            "error": "no cashiers cached (click Sync first)",
                            "hint": "Create a cashier in Admin, then press Sync on the POS.",
                        },
                        status=503,
                    )
                else:
                    json_response(
                        self,
                        {
                            "error": "invalid pin",
                            "hint": "If you just created/changed this cashier PIN, press Sync then try again.",
                        },
                        status=401,
                    )
                return
            cfg['cashier_id'] = cashier['id']
            save_config(cfg)
            json_response(self, {'ok': True, 'cashier': cashier, 'config': cfg})
            return

        if parsed.path == '/api/cashiers/logout':
            cfg = load_config()
            cfg['cashier_id'] = ''
            save_config(cfg)
            json_response(self, {'ok': True, 'config': cfg})
            return

        if parsed.path == '/api/cash-movement':
            data = self.read_json()
            cfg = load_config()
            shift_id = data.get('shift_id') or cfg.get('shift_id') or None
            if not shift_id:
                json_response(self, {'error': 'no open shift'}, status=400)
                return
            movement_type = (data.get('movement_type') or '').strip()
            if not movement_type:
                json_response(self, {'error': 'movement_type is required'}, status=400)
                return
            payload = {
                'shift_id': shift_id,
                'cashier_id': data.get('cashier_id') or cfg.get('cashier_id') or None,
                'movement_type': movement_type,
                'amount_usd': float(data.get('amount_usd') or 0),
                'amount_lbp': float(data.get('amount_lbp') or 0),
                'notes': (data.get('notes') or '').strip() or None
            }
            event_id = add_outbox_event('pos.cash_movement', payload)
            json_response(self, {'event_id': event_id})
            return

        if parsed.path == '/api/sync/pull':
            cfg = load_config()
            try:
                base = _require_api_base(cfg)
            except Exception:
                json_response(self, {"error": "missing api_base_url"}, status=400)
                return
            company_id = (cfg.get('company_id') or "").strip()
            if not company_id:
                json_response(self, {"error": "missing company_id"}, status=400)
                return
            if not cfg.get('device_id') or not cfg.get('device_token'):
                json_response(self, {'error': 'missing device_id or device_token'}, status=400)
                return
            try:
                headers = device_headers(cfg)
                out = {}

                # Categories (delta-first).
                delta = sync_resource_delta(base, headers, "categories", f"{base}/pos/item-categories/catalog/delta", "categories", upsert_categories)
                if delta is None:
                    out["categories"] = sync_resource_snapshot(base, headers, "categories", f"{base}/pos/item-categories/catalog", "categories", upsert_categories)
                else:
                    out["categories"] = delta

                # Catalog (delta-first).
                delta = sync_resource_delta(base, headers, "catalog", f"{base}/pos/catalog/delta?company_id={quote(str(company_id))}", "items", upsert_catalog)
                if delta is None:
                    out["catalog"] = sync_resource_snapshot(base, headers, "catalog", f"{base}/pos/catalog?company_id={quote(str(company_id))}", "items", upsert_catalog)
                else:
                    out["catalog"] = delta

                # Cashiers (small; snapshot is fine).
                cashiers = fetch_json(f"{base}/pos/cashiers/catalog", headers=headers)
                upsert_cashiers(cashiers.get("cashiers", []))
                out["cashiers"] = {"mode": "snapshot", "count": len(cashiers.get("cashiers", []) or [])}

                # Customers (delta-first).
                delta = sync_resource_delta(base, headers, "customers", f"{base}/pos/customers/catalog/delta", "customers", upsert_customers)
                if delta is None:
                    out["customers"] = sync_resource_snapshot(base, headers, "customers", f"{base}/pos/customers/catalog", "customers", upsert_customers)
                else:
                    out["customers"] = delta

                # Promotions (delta-first).
                delta = sync_resource_delta(base, headers, "promotions", f"{base}/pos/promotions/delta", "promotions", upsert_promotions)
                if delta is None:
                    out["promotions"] = sync_resource_snapshot(base, headers, "promotions", f"{base}/pos/promotions/catalog", "promotions", upsert_promotions)
                else:
                    out["promotions"] = delta

                # Pull device-scoped config (warehouse, VAT settings) to reduce manual setup.
                pos_cfg = fetch_json(f"{base}/pos/config", headers=headers)
                if pos_cfg.get('default_warehouse_id'):
                    cfg['warehouse_id'] = pos_cfg['default_warehouse_id']
                if isinstance(pos_cfg.get("inventory_policy"), dict):
                    cfg["inventory_policy"] = pos_cfg.get("inventory_policy") or {}
                vat = pos_cfg.get('vat') or {}
                if vat.get('id'):
                    cfg['tax_code_id'] = vat['id']
                if vat.get('rate') is not None:
                    cfg['vat_rate'] = float(vat['rate'])
                # Optional: all VAT tax codes (id -> rate) for item-level VAT handling.
                vat_codes = pos_cfg.get("vat_codes")
                if isinstance(vat_codes, list):
                    vc = {}
                    for r in vat_codes:
                        try:
                            tid = (r.get("id") if isinstance(r, dict) else None)
                            if not tid:
                                continue
                            vc[str(tid)] = float((r.get("rate") if isinstance(r, dict) else 0) or 0)
                        except Exception:
                            continue
                    cfg["vat_codes"] = vc
                rate = fetch_json(f"{base}/pos/exchange-rate", headers=headers)
                if rate.get('rate'):
                    cfg['exchange_rate'] = rate['rate']['usd_to_lbp']
                # Persist config updates even if exchange rate fetch fails.
                save_config(cfg)

                # Apply inbox events (server -> device), then ACK.
                inbox = fetch_json(f"{base}/pos/inbox/pull?limit=200", headers=headers)
                applied = apply_inbox_events(inbox.get("events", []) or [], cfg)
                if applied:
                    try:
                        post_json(f"{base}/pos/inbox/ack", {"event_ids": applied}, headers=headers)
                    except URLError:
                        pass

                json_response(
                    self,
                    {
                        'ok': True,
                        'sync': out,
                        'applied_inbox': len(applied or []),
                    },
                )
            except URLError as ex:
                json_response(self, {'error': str(ex)}, status=502)
            return

        if parsed.path == '/api/shift/status':
            cfg = load_config()
            try:
                base = _require_api_base(cfg)
            except Exception:
                json_response(self, {"error": "missing api_base_url"}, status=400)
                return
            if not cfg.get('device_id') or not cfg.get('device_token'):
                json_response(self, {'error': 'missing device_id or device_token'}, status=400)
                return
            try:
                res = fetch_json(f"{base}/pos/shifts/open", headers=device_headers(cfg))
                shift = res.get('shift')
                cfg['shift_id'] = shift['id'] if shift else ''
                save_config(cfg)
                json_response(self, {'shift': shift})
            except URLError as ex:
                json_response(self, {'error': str(ex)}, status=502)
            return

        if parsed.path == '/api/shift/open':
            cfg = load_config()
            try:
                base = _require_api_base(cfg)
            except Exception:
                json_response(self, {"error": "missing api_base_url"}, status=400)
                return
            data = self.read_json()
            if not cfg.get('device_id') or not cfg.get('device_token'):
                json_response(self, {'error': 'missing device_id or device_token'}, status=400)
                return
            try:
                if not data.get("cashier_id") and cfg.get("cashier_id"):
                    data["cashier_id"] = cfg["cashier_id"]
                res = post_json(f"{base}/pos/shifts/open", data, headers=device_headers(cfg))
                shift = res.get('shift')
                if shift:
                    cfg['shift_id'] = shift['id']
                    save_config(cfg)
                json_response(self, {'shift': shift})
            except URLError as ex:
                json_response(self, {'error': str(ex)}, status=502)
            return

        if parsed.path == '/api/shift/close':
            cfg = load_config()
            try:
                base = _require_api_base(cfg)
            except Exception:
                json_response(self, {"error": "missing api_base_url"}, status=400)
                return
            data = self.read_json()
            shift_id = cfg.get('shift_id')
            if not shift_id:
                json_response(self, {'error': 'no open shift'}, status=400)
                return
            if not cfg.get('device_id') or not cfg.get('device_token'):
                json_response(self, {'error': 'missing device_id or device_token'}, status=400)
                return
            try:
                if not data.get("cashier_id") and cfg.get("cashier_id"):
                    data["cashier_id"] = cfg["cashier_id"]
                res = post_json(f"{base}/pos/shifts/{shift_id}/close", data, headers=device_headers(cfg))
                cfg['shift_id'] = ''
                save_config(cfg)
                json_response(self, {'shift': res.get('shift')})
            except URLError as ex:
                json_response(self, {'error': str(ex)}, status=502)
            return

        if parsed.path == '/api/sync/push':
            cfg = load_config()
            try:
                base = _require_api_base(cfg)
            except Exception:
                json_response(self, {"error": "missing api_base_url"}, status=400)
                return
            company_id = (cfg.get('company_id') or "").strip()
            if not company_id:
                json_response(self, {"error": "missing company_id"}, status=400)
                return
            device_id = (cfg.get('device_id') or "").strip()
            if not device_id or not cfg.get('device_token'):
                json_response(self, {'error': 'missing device_id or device_token'}, status=400)
                return
            events = []
            with db_connect() as conn:
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT event_id, event_type, payload_json, created_at
                    FROM pos_outbox_events
                    WHERE status = 'pending'
                    ORDER BY created_at
                    """
                )
                rows = cur.fetchall()
                for r in rows:
                    events.append({
                        'event_id': r['event_id'],
                        'event_type': r['event_type'],
                        'payload': json.loads(r['payload_json']),
                        'created_at': r['created_at']
                    })
            if not events:
                json_response(self, {'ok': True, 'sent': 0})
                return
            payload = {
                'company_id': company_id,
                'device_id': device_id,
                'events': events
            }
            try:
                res = post_json(f"{base}/pos/outbox/submit", payload, headers=device_headers(cfg))
                accepted = res.get('accepted', [])
                if accepted:
                    mark_outbox_sent(accepted)
                json_response(self, {'ok': True, 'sent': len(accepted), 'rejected': res.get('rejected', [])})
            except URLError as ex:
                json_response(self, {'error': str(ex)}, status=502)
            return

        json_response(self, {'error': 'not found'}, status=404)


def main():
    global DB_PATH, CONFIG_PATH
    parser = argparse.ArgumentParser()
    parser.add_argument("--init-db", action="store_true", help="Initialize local SQLite schema and exit")
    parser.add_argument(
        "--db",
        default=os.environ.get("POS_DB_PATH", DB_PATH),
        help="SQLite DB path (default: pos-desktop/pos.sqlite). Useful to run multiple agents (one per company).",
    )
    parser.add_argument(
        "--config",
        default=os.environ.get("POS_CONFIG_PATH", CONFIG_PATH),
        help="Config JSON path (default: pos-desktop/config.json). Useful to run multiple agents (one per company).",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("POS_HOST", "127.0.0.1"),
        help="HTTP host to bind (default: 127.0.0.1). Use 0.0.0.0 only if you explicitly want LAN exposure.",
    )
    parser.add_argument("--port", type=int, default=int(os.environ.get("POS_PORT", "7070")), help="HTTP port (default: 7070)")
    args = parser.parse_args()

    # Override module-level paths so the rest of the agent uses the selected files.
    # This is intentionally global because helpers read DB_PATH/CONFIG_PATH directly.
    DB_PATH = os.path.abspath(args.db)
    CONFIG_PATH = os.path.abspath(args.config)

    if args.init_db:
        init_db()
        print("ok")
        return

    init_db()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    # Print localhost for convenience when bound locally; otherwise print the explicit host.
    public_host = "localhost" if args.host in {"127.0.0.1", "localhost"} else args.host
    print(f"POS Agent running on http://{public_host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
