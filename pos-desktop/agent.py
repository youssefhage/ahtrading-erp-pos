#!/usr/bin/env python3
import argparse
import html
import json
import math
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import textwrap
import threading
import uuid
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote, urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
import secrets
import logging
from typing import Optional
import time

import bcrypt

_agent_logger = logging.getLogger("pos-agent")

# ---------------------------------------------------------------------------
# C-2: Rate limiting for PIN verification
# ---------------------------------------------------------------------------
_pin_attempts = {}  # key -> {"count": int, "locked_until": float}
_PIN_MAX_ATTEMPTS = 5
_PIN_LOCKOUT_SECONDS = 60


def _check_pin_rate_limit(key: str) -> bool:
    """Returns True if the request should be blocked."""
    import time as _t
    now = _t.time()
    entry = _pin_attempts.get(key)
    if entry and entry["locked_until"] > now:
        return True
    return False


def _record_pin_failure(key: str):
    import time as _t
    now = _t.time()
    entry = _pin_attempts.get(key, {"count": 0, "locked_until": 0})
    entry["count"] = entry.get("count", 0) + 1
    if entry["count"] >= _PIN_MAX_ATTEMPTS:
        entry["locked_until"] = now + _PIN_LOCKOUT_SECONDS
        entry["count"] = 0
    _pin_attempts[key] = entry


def _reset_pin_attempts(key: str):
    _pin_attempts.pop(key, None)


# ---------------------------------------------------------------------------
# C-3 / H-11: Allowlists for configuration patching and API writes
# ---------------------------------------------------------------------------
_CONFIG_PATCHABLE_KEYS = {
    "company_name", "branch_name", "vat_rate", "vat_codes",
    "receipt_template", "receipt_header", "receipt_footer",
    "receipt_show_logo", "receipt_logo_url",
    "default_customer_id", "default_customer_name",
    "default_warehouse_id", "default_warehouse_name",
    "allow_negative_stock", "allow_credit_sale",
    "require_manager_approval_credit", "require_manager_approval_returns",
    "require_manager_approval_discount", "require_manager_approval_cross_company",
    "max_discount_pct", "loyalty_enabled",
    "printer_type", "printer_address",
    "currency_label_usd", "currency_label_lbp",
    "receipt_hide_vat",
}

_CONFIG_API_WRITABLE_KEYS = {
    "company_name", "branch_name", "receipt_template", "receipt_header",
    "receipt_footer", "receipt_show_logo", "receipt_logo_url",
    "printer_type", "printer_address", "printer_width_mm", "printer_width_chars",
    "default_customer_id", "default_customer_name",
    "default_warehouse_id", "default_warehouse_name",
    "allow_negative_stock", "allow_credit_sale",
    "require_manager_approval_credit", "require_manager_approval_returns",
    "require_manager_approval_discount", "require_manager_approval_cross_company",
    "max_discount_pct",
    "loyalty_enabled", "currency_label_usd", "currency_label_lbp",
    "admin_session_hours", "receipt_hide_vat",
    "invoice_template",
    # Printing settings (used by the Printing modal in the UI)
    "receipt_printer", "receipt_print_copies", "auto_print_receipt",
    "receipt_company_name", "receipt_footer_text",
    "invoice_printer", "invoice_print_copies", "auto_print_invoice",
    "print_base_url",
    # Queue / outbox settings
    "outbox_stale_warn_minutes",
    # Device setup keys (written by SettingsScreen after registration & manual edits)
    "api_base_url", "cloud_api_base_url",
    "company_id", "device_id", "device_token", "device_code",
    "warehouse_id", "branch_id",
    "pricing_currency", "exchange_rate",
}

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
    # Cloud mode:
    # - cloud_api_base_url: preferred backend base URL
    # - api_base_url: legacy fallback
    # - edge_api_base_url: legacy alias accepted for backward compatibility
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
    # Optional operation-level manager approval gates.
    # When enabled, cashier must unlock with admin PIN (X-POS-Session) before these actions.
    'require_manager_approval_credit': False,
    'require_manager_approval_returns': False,
    'require_manager_approval_cross_company': False,
    # UI warning threshold for stale outbox backlog.
    'outbox_stale_warn_minutes': 5,

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
    # Thermal receipt format profile.
    # Supported: classic, compact, detailed
    'receipt_template': 'classic',
    # Optional display label for receipt header.
    'receipt_company_name': 'AH Trading',
    # Optional line printed at the end of each receipt.
    'receipt_footer_text': '',
    # When set to true, VAT line is omitted from printed/thermal receipts.
    # When null/unset, auto-detected: hidden for unofficial companies, shown for official.
    'receipt_hide_vat': None,

    # Official invoice printing (A4 PDF) (optional)
    'invoice_printer': '',
    'invoice_print_copies': 1,
    'auto_print_invoice': False,
    # A4 invoice PDF template profile (served by Admin /exports route).
    # Supported: official_classic, official_compact, standard
    'invoice_template': 'official_classic',
}


def _round_usd(value) -> float:
    try:
        return max(0.0, round(float(value or 0.0) + 1e-9, 2))
    except Exception:
        return 0.0


def _round_lbp(value) -> int:
    try:
        return max(0, int(round(float(value or 0.0) + 1e-9)))
    except Exception:
        return 0


RECEIPT_TEMPLATES = {
    "classic": {
        "id": "classic",
        "label": "Classic",
        "description": "Balanced layout with core metadata and totals.",
    },
    "compact": {
        "id": "compact",
        "label": "Compact",
        "description": "Minimal metadata for faster thermal prints.",
    },
    "detailed": {
        "id": "detailed",
        "label": "Detailed",
        "description": "Expanded line details with SKU and unit pricing.",
    },
}

INVOICE_TEMPLATES = {
    "official_classic": {
        "id": "official_classic",
        "label": "Client Invoice (Classic)",
        "description": "Official client invoice layout with company branding.",
    },
    "official_compact": {
        "id": "official_compact",
        "label": "Client Invoice (Compact)",
        "description": "Compact official client invoice layout.",
    },
    "standard": {
        "id": "standard",
        "label": "Standard Invoice",
        "description": "General invoice layout used by non-official companies.",
    },
}

OFFICIAL_COMPANY_ID = "00000000-0000-0000-0000-000000000001"


def _normalize_receipt_template_id(value) -> str:
    v = str(value or "classic").strip().lower()
    if v in RECEIPT_TEMPLATES:
        return v
    return "classic"


def _clean_receipt_text(value, fallback: str = "", limit: int = 120) -> str:
    raw = str(value if value is not None else fallback).strip()
    if not raw:
        return ""
    return raw[: max(1, int(limit or 120))]


def _receipt_render_profile(cfg: Optional[dict] = None) -> dict:
    c = cfg or {}
    company_id = str(c.get("company_id") or "").strip()
    is_unofficial = bool(company_id) and company_id != OFFICIAL_COMPANY_ID
    # receipt_hide_vat: explicit bool overrides auto-detect; None/missing falls back to company type.
    hide_vat_raw = c.get("receipt_hide_vat")
    if isinstance(hide_vat_raw, bool):
        hide_vat = hide_vat_raw
    else:
        hide_vat = is_unofficial
    return {
        "template_id": _normalize_receipt_template_id(c.get("receipt_template")),
        "company_name": _clean_receipt_text(c.get("receipt_company_name"), fallback="AH Trading", limit=64) or "AH Trading",
        "footer_text": _clean_receipt_text(c.get("receipt_footer_text"), fallback="", limit=160),
        "hide_company_name": is_unofficial,
        "hide_vat_reference": hide_vat,
    }


def _receipt_templates_payload() -> list[dict]:
    return [RECEIPT_TEMPLATES[k] for k in ("classic", "compact", "detailed")]


def _effective_printer_width_chars(cfg: Optional[dict] = None, template_id: str = "classic") -> Optional[int]:
    """
    Derive the effective receipt character width from config.

    Priority:
      1. printer_width_chars  (explicit override)
      2. printer_width_mm     (converted: ~0.55 chars per mm for standard thermal font)
      3. None                 (let _receipt_text() use its template default)
    """
    c = cfg or {}
    # Explicit chars override
    try:
        wc = int(c.get("printer_width_chars") or 0)
        if wc > 0:
            return max(16, min(64, wc))
    except (ValueError, TypeError):
        pass
    # Derive from mm
    try:
        mm = float(c.get("printer_width_mm") or 0)
        if mm > 0:
            # ~0.55 chars/mm for Font A (12x24) on standard thermal printers.
            # 58mm paper → ~32 chars, 80mm → ~44 chars.
            chars = int(mm * 0.55)
            return max(16, min(64, chars))
    except (ValueError, TypeError):
        pass
    return None


def _normalize_invoice_template_id(value) -> str:
    v = str(value or "official_classic").strip().lower()
    if v in INVOICE_TEMPLATES:
        return v
    return "official_classic"


def _effective_invoice_template_id(value, company_id: Optional[str] = None) -> str:
    tpl = _normalize_invoice_template_id(value)
    # Temporary policy: official client invoices should never use legacy standard layout.
    if str(company_id or "").strip() == OFFICIAL_COMPANY_ID and tpl == "standard":
        return "official_classic"
    return tpl


def _invoice_templates_payload() -> list[dict]:
    return [INVOICE_TEMPLATES[k] for k in ("official_classic", "official_compact", "standard")]


def load_config():
    if not os.path.exists(CONFIG_PATH):
        save_config(DEFAULT_CONFIG)
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    cfg = {**DEFAULT_CONFIG, **data}
    # Allow Docker/ops to override without rewriting the on-disk config.
    if os.environ.get("POS_API_BASE_URL"):
        cfg["api_base_url"] = os.environ["POS_API_BASE_URL"]
        # Back-compat: if cloud URL is not provided, seed it from POS_API_BASE_URL.
        if not (cfg.get("cloud_api_base_url") or "").strip():
            cfg["cloud_api_base_url"] = os.environ["POS_API_BASE_URL"]
    if os.environ.get("POS_EDGE_API_BASE_URL"):
        cfg["edge_api_base_url"] = os.environ["POS_EDGE_API_BASE_URL"]
        # Legacy env name: use it as cloud base if cloud is still missing.
        if not (cfg.get("cloud_api_base_url") or "").strip():
            cfg["cloud_api_base_url"] = os.environ["POS_EDGE_API_BASE_URL"]
    if os.environ.get("POS_CLOUD_API_BASE_URL"):
        cfg["cloud_api_base_url"] = os.environ["POS_CLOUD_API_BASE_URL"]
    if os.environ.get("POS_COMPANY_ID"):
        cfg["company_id"] = os.environ["POS_COMPANY_ID"]
    if os.environ.get("POS_DEVICE_ID"):
        cfg["device_id"] = os.environ["POS_DEVICE_ID"]
    if os.environ.get("POS_DEVICE_TOKEN"):
        cfg["device_token"] = os.environ["POS_DEVICE_TOKEN"]
    cfg["receipt_template"] = _normalize_receipt_template_id(cfg.get("receipt_template"))
    cfg["receipt_company_name"] = _clean_receipt_text(cfg.get("receipt_company_name"), fallback="AH Trading", limit=64) or "AH Trading"
    cfg["receipt_footer_text"] = _clean_receipt_text(cfg.get("receipt_footer_text"), fallback="", limit=160)
    cfg["invoice_template"] = _effective_invoice_template_id(cfg.get("invoice_template"), cfg.get("company_id"))
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
    ip = (ip or "").strip().lower()
    if ip in {"127.0.0.1", "::1", "localhost"}:
        return True
    if ip.startswith("::ffff:"):
        tail = ip.split("::ffff:", 1)[1]
        return tail.startswith("127.")
    return ip.startswith("127.")

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
    handler.send_header("Access-Control-Allow-Headers", "Content-Type,X-POS-Session,X-POS-Manager-Session")
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
    now = datetime.now(timezone.utc).isoformat()
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
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=hours_i)).isoformat()
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


def _manager_session_valid(handler) -> bool:
    token = (handler.headers.get("X-POS-Manager-Session") or "").strip()
    if not token:
        token = (handler.headers.get("X-POS-Session") or "").strip()
    return _validate_admin_session(token)


def _require_manager_approval(handler, cfg: dict) -> bool:
    """
    Require an admin-unlocked session for risky operations.
    Returns True when request handling should stop.
    """
    if _manager_session_valid(handler):
        return False
    if not (cfg.get("admin_pin_hash") or "").strip():
        json_response(
            handler,
            {
                "error": "manager_approval_required",
                "hint": "Set admin PIN first (POST /api/admin/pin/set), then unlock with POST /api/auth/pin.",
            },
            status=503,
        )
        return True
    json_response(
        handler,
        {
            "error": "manager_approval_required",
            "hint": "Manager approval required. Unlock with admin PIN and retry.",
        },
        status=403,
    )
    return True

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


def _preflight_legacy_outbox_schema(conn) -> None:
    """
    Keep legacy local DBs bootable before loading the full schema script.

    Older POS installs created `pos_outbox_events` without `idempotency_key`.
    The current schema adds indexes that reference that column, so we must add
    it first to avoid failing inside `conn.executescript(schema)`.
    """
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS pos_outbox_events (
          event_id TEXT PRIMARY KEY,
          event_type TEXT,
          payload_json TEXT,
          created_at TEXT,
          status TEXT DEFAULT 'pending',
          idempotency_key TEXT
        )
        """
    )
    cur.execute("PRAGMA table_info(pos_outbox_events)")
    outbox_cols = {r[1] for r in cur.fetchall()}
    if "idempotency_key" not in outbox_cols:
        cur.execute("ALTER TABLE pos_outbox_events ADD COLUMN idempotency_key TEXT")


def init_db():
    if not os.path.exists(SCHEMA_PATH):
        raise RuntimeError(f"Missing schema file: {SCHEMA_PATH}")
    with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
        schema = f.read()
    with db_connect() as conn:
        _preflight_legacy_outbox_schema(conn)
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
        cur.execute("PRAGMA table_info(local_cashiers_cache)")
        cashier_cols = {r[1] for r in cur.fetchall()}
        cashier_wanted = {
            "user_id": "TEXT",
            "user_email": "TEXT",
        }
        for col, ddl in cashier_wanted.items():
            if col not in cashier_cols:
                cur.execute(f"ALTER TABLE local_cashiers_cache ADD COLUMN {col} {ddl}")

        # Outbox idempotency (safe retries without duplicate documents).
        cur.execute("PRAGMA table_info(pos_outbox_events)")
        outbox_cols = {r[1] for r in cur.fetchall()}
        if "idempotency_key" not in outbox_cols:
            cur.execute("ALTER TABLE pos_outbox_events ADD COLUMN idempotency_key TEXT")
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
            CREATE INDEX IF NOT EXISTS idx_pos_outbox_event_type_idem ON pos_outbox_events(event_type, idempotency_key);
            CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_outbox_event_type_idem_nonempty
              ON pos_outbox_events(event_type, idempotency_key)
              WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';
            """
        )
        conn.commit()


def json_response(handler, payload, status=200):
    body = json.dumps(payload).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json')
    handler.send_header('X-Content-Type-Options', 'nosniff')
    handler.send_header('X-Frame-Options', 'DENY')
    handler.send_header('Cache-Control', 'no-store')
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
        handler.send_header('X-Content-Type-Options', 'nosniff')
        _maybe_send_cors_headers(handler)
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

def _parse_windows_printers_json(raw: str) -> tuple:
    txt = (raw or "").strip()
    if not txt:
        return [], None
    obj = json.loads(txt)
    rows = obj if isinstance(obj, list) else ([obj] if isinstance(obj, dict) else [])
    printers: list[dict] = []
    default_name: Optional[str] = None
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
    return printers, default_name

def _parse_windows_printers_wmic(raw: str) -> tuple:
    """
    Parse `wmic printer get Name,Default /format:csv` output.
    Example lines:
      Node,Default,Name
      MY-PC,TRUE,HP LaserJet
      MY-PC,FALSE,Microsoft Print to PDF
    """
    printers: list[dict] = []
    default_name: Optional[str] = None
    lines = [ln.strip() for ln in (raw or "").splitlines() if ln.strip()]
    if not lines:
        return printers, default_name
    # Skip header-like rows and parse CSV-ish columns from the right.
    for ln in lines:
        low = ln.lower()
        if low.startswith("node,") or low.startswith("name,") or low.startswith("default,"):
            continue
        parts = [p.strip() for p in ln.split(",")]
        if len(parts) < 3:
            continue
        # WMIC CSV columns are generally: Node,Default,Name
        is_def_txt = parts[-2].strip().lower()
        name = parts[-1].strip()
        if not name:
            continue
        is_def = is_def_txt in ("true", "yes", "1")
        if is_def and not default_name:
            default_name = name
        printers.append({"name": name, "is_default": is_def})
    return printers, default_name

_printer_cache: dict = {"result": None, "ts": 0.0}
_printer_cache_lock = threading.Lock()
_PRINTER_CACHE_TTL_S = 60.0


def list_system_printers(force_refresh: bool = False) -> dict:
    """
    Enumerate printers available on this machine (best-effort).
    Results are cached for 60 seconds to avoid repeated slow OS queries.
    Thread-safe: guarded by ``_printer_cache_lock``.
    """
    import time as _time
    with _printer_cache_lock:
        now = _time.monotonic()
        if not force_refresh and _printer_cache["result"] is not None and (now - _printer_cache["ts"]) < _PRINTER_CACHE_TTL_S:
            return _printer_cache["result"]
    # Release lock during the (potentially slow) OS query.
    out = _list_system_printers_uncached()
    with _printer_cache_lock:
        _printer_cache["result"] = out
        _printer_cache["ts"] = _time.monotonic()
    return out


def _list_system_printers_uncached() -> dict:
    out: dict = {"printers": [], "default_printer": None, "error": None}

    # Windows: query via PowerShell (Get-Printer).
    if sys.platform.startswith("win"):
        ps = shutil.which("powershell") or shutil.which("pwsh")
        # Use JSON so we can reliably detect default printer.
        # Some Windows terminals are slow to spawn PowerShell, so use a higher timeout.
        ps_cmds = []
        if ps:
            ps_cmds.append((
                [ps, "-NoProfile", "-NonInteractive", "-Command",
                 "Get-Printer | Select-Object Name, Default | ConvertTo-Json -Compress"],
                12.0,
                "powershell:get-printer",
            ))
            ps_cmds.append((
                [ps, "-NoProfile", "-NonInteractive", "-Command",
                 "Get-CimInstance Win32_Printer | Select-Object Name, Default | ConvertTo-Json -Compress"],
                15.0,
                "powershell:cim-printer",
            ))

        attempts: list[str] = []
        for args, timeout_s, label in ps_cmds:
            code, stdout, stderr = _run_cmd(args, timeout_s=timeout_s)
            if code != 0:
                msg = (stderr or f"{label} failed").strip()
                attempts.append(f"{label}: {msg}")
                continue
            raw = (stdout or "").strip()
            if not raw:
                attempts.append(f"{label}: empty output")
                continue
            try:
                printers, default_name = _parse_windows_printers_json(raw)
                out["printers"] = printers
                out["default_printer"] = default_name
                if printers:
                    return out
                attempts.append(f"{label}: no printers")
            except Exception as ex:
                attempts.append(f"{label}: {str(ex)}")

        # Last-resort fallback for older systems where PowerShell printer cmdlets are flaky.
        wmic = shutil.which("wmic")
        if wmic:
            code, stdout, stderr = _run_cmd([wmic, "printer", "get", "Name,Default", "/format:csv"], timeout_s=8.0)
            if code == 0:
                printers, default_name = _parse_windows_printers_wmic(stdout or "")
                out["printers"] = printers
                out["default_printer"] = default_name
                if printers:
                    return out
                attempts.append("wmic: no printers")
            else:
                attempts.append(f"wmic: {(stderr or 'printer query failed').strip()}")

        if attempts:
            out["error"] = " ; ".join(attempts)
        elif not ps:
            out["error"] = "powershell not found"
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


def _join_url(base: str, endpoint: str) -> str:
    return f"{_normalize_api_base_url(base)}/{str(endpoint or '').lstrip('/')}"


def _replace_base_path(base: str, new_path: str) -> str:
    u = urlparse(base)
    return u._replace(path=new_path, params="", query="", fragment="").geturl().rstrip("/")


def _setup_api_candidate_urls(api_base: str, endpoint: str) -> list[str]:
    base = _normalize_api_base_url(api_base)
    ep = str(endpoint or "").strip().lstrip("/")
    if not base or not ep:
        return []
    out = []

    def _add(url: str):
        url = _normalize_api_base_url(url)
        if url and url not in out:
            out.append(url)

    # First try exactly what user entered.
    _add(_join_url(base, ep))

    # Then try the sibling path with/without "/api" once.
    p = urlparse(base)
    path = (p.path or "").rstrip("/")
    if path.endswith("/api"):
        alt_path = path[:-4] or "/"
    else:
        alt_path = (path + "/api") if path else "/api"
    alt_base = _replace_base_path(base, alt_path)
    _add(_join_url(alt_base, ep))
    return out


def _setup_req_json_with_api_fallback(
    api_base: str,
    endpoint: str,
    *,
    method: str = "GET",
    payload=None,
    headers=None,
    timeout_s: float = 12.0,
):
    attempts = _setup_api_candidate_urls(api_base, endpoint)
    if not attempts:
        return None, 400, "api_base_url is required"
    last_res = None
    last_status = None
    last_err = None
    for i, url in enumerate(attempts):
        res, status, err = _setup_req_json_safe(
            url,
            method=method,
            payload=payload,
            headers=headers,
            timeout_s=timeout_s,
        )
        if status is None:
            return res, None, None
        last_res, last_status, last_err = res, status, err
        is_last = i == (len(attempts) - 1)
        # Fallback only when endpoint likely does not exist on that base path.
        if is_last or int(status or 0) not in (404, 405):
            return last_res, last_status, last_err
    return last_res, last_status, last_err


_ACTIVE_API_CACHE = {
    "checked_at": 0.0,
    "base": "",
    "mode": "",
    "detail": "",
}
_ACTIVE_API_TTL_S = 3.0


def _configured_legacy_edge_base(cfg: dict) -> str:
    return _normalize_api_base_url(cfg.get("edge_api_base_url") or "")


def _configured_cloud_base(cfg: dict) -> str:
    return _normalize_api_base_url(
        cfg.get("cloud_api_base_url") or cfg.get("api_base_url") or cfg.get("edge_api_base_url") or ""
    )


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
    Returns (base_url, mode, detail). In cloud mode we use a single API base.
    Uses a short TTL cache to avoid recomputing on every request.
    """
    now = time.time()
    if not force:
        cached = _ACTIVE_API_CACHE
        if cached.get("base") and (now - float(cached.get("checked_at") or 0)) < _ACTIVE_API_TTL_S:
            return str(cached["base"]), str(cached.get("mode") or ""), str(cached.get("detail") or "")

    cloud = _configured_cloud_base(cfg)
    if cloud:
        base, mode, detail = cloud, "cloud", "cloud api configured"
    else:
        base, mode, detail = "", "", "missing cloud_api_base_url/api_base_url"

    if base and not base.startswith("https://") and "localhost" not in base and "127.0.0.1" not in base:
        _agent_logger.warning("Cloud API URL is not HTTPS: %s — traffic may be unencrypted", base)

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
    out["sync_api_base_url"] = base
    out["edge_api_base_url"] = _configured_legacy_edge_base(cfg)
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
    out["sync_api_base_url"] = base
    out["edge_api_base_url"] = _configured_legacy_edge_base(cfg)
    out["cloud_api_base_url"] = _configured_cloud_base(cfg)
    return out


def submit_single_event(
    cfg: dict,
    event_id: str,
    event_type: str,
    payload: dict,
    created_at: str,
    idempotency_key: Optional[str] = None,
) -> tuple[bool, dict]:
    """
    Submit a single outbox event immediately to the cloud API.
    Used as best-effort fast-path for higher-risk ops like credit sales and returns.
    """
    try:
        base = _require_api_base(cfg)
    except Exception:
        base = ""
    company_id = (cfg.get("company_id") or "").strip()
    device_id = (cfg.get("device_id") or "").strip()
    if not base or not company_id or not device_id:
        return False, {"error": "missing sync configuration"}
    if not (cfg.get("device_token") or "").strip():
        return False, {"error": "missing device token"}
    idem = str(idempotency_key or "").strip() or None
    event = {"event_id": event_id, "event_type": event_type, "payload": payload, "created_at": created_at}
    if idem:
        event["idempotency_key"] = idem
    bundle = {
        "company_id": company_id,
        "device_id": device_id,
        "events": [event],
    }
    try:
        res = post_json(f"{base.rstrip('/')}/pos/outbox/submit", bundle, headers=device_headers(cfg))
    except HTTPError as ex:
        body = ""
        try:
            body = ex.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""
        return False, {"error": f"http_{int(getattr(ex, 'code', 0) or 0)}", "detail": body or str(ex)}
    except URLError as ex:
        return False, {"error": "network_error", "detail": str(ex)}
    except Exception as ex:
        return False, {"error": "submit_failed", "detail": str(ex)}
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
            (resource, cursor, cursor_id, datetime.now(timezone.utc).isoformat()),
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
    now = datetime.now(timezone.utc).isoformat()
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
                    if k in _CONFIG_PATCHABLE_KEYS:
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
    server_time = (res or {}).get("server_time") or datetime.now(timezone.utc).isoformat()
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
            SELECT id, name, user_id, user_email, is_active, updated_at
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
                    (c.get("updated_at") or c.get("changed_at") or datetime.now(timezone.utc).isoformat()),
                ),
            )
        conn.commit()

def upsert_cashiers(cashiers):
    with db_connect() as conn:
        cur = conn.cursor()
        for c in cashiers:
            cur.execute(
                """
                INSERT INTO local_cashiers_cache (id, name, user_id, user_email, pin_hash, is_active, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name=excluded.name,
                  user_id=excluded.user_id,
                  user_email=excluded.user_email,
                  pin_hash=excluded.pin_hash,
                  is_active=excluded.is_active,
                  updated_at=excluded.updated_at
                """,
                (
                    c.get("id"),
                    c.get("name"),
                    c.get("user_id"),
                    c.get("user_email"),
                    c.get("pin_hash"),
                    1 if c.get("is_active") else 0,
                    datetime.now(timezone.utc).isoformat(),
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
                    (p.get("updated_at") or datetime.now(timezone.utc).isoformat()),
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
    created_at = datetime.now(timezone.utc).isoformat()
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


def _receipt_html(receipt_row, cfg: Optional[dict] = None):
    if not receipt_row:
        return """<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Receipt</title></head><body><p>No receipt yet.</p></body></html>"""

    profile = _receipt_render_profile(cfg)
    template_id = profile["template_id"]
    company_name = profile["company_name"]
    footer_text = profile["footer_text"]
    hide_company_name = bool(profile.get("hide_company_name"))
    hide_vat_reference = bool(profile.get("hide_vat_reference"))

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
    cashier_name = cashier.get("name") or cashier.get("id") or "-"
    customer_name = str(r.get("customer_name") or "").strip()
    customer_id = str(r.get("customer_id") or "").strip()
    customer_label = customer_name or customer_id or "-"
    customer_balance = r.get("customer_balance") if isinstance(r.get("customer_balance"), dict) else None

    meta_rows = []
    meta_rows.append(f'<div class="muted">Time: <span class="mono">{e(r.get("created_at") or "-")}</span></div>')
    if template_id != "compact":
        meta_rows.append(f'<div class="muted">Event: <span class="mono">{e(r.get("event_id") or "-")}</span></div>')
        meta_rows.append(f'<div class="muted">Shift: <span class="mono">{e(r.get("shift_id") or "-")}</span></div>')
    meta_rows.append(f'<div class="muted">Customer: <span class="mono">{e(customer_label)}</span></div>')
    meta_rows.append(f'<div class="muted">Cashier: <span>{e(cashier_name)}</span></div>')
    meta_rows.append(f'<div class="muted">Payment: <span>{e(r.get("payment_method") or "-")}</span></div>')

    line_rows = []
    for ln in lines:
        name = (ln.get("name") or "").strip() or (ln.get("sku") or "").strip() or ln.get("item_id") or ""
        qty_entered = ln.get("qty_entered")
        qty = qty_entered if qty_entered is not None else (ln.get("qty") or 0)
        uom = (ln.get("uom") or "").strip()
        qty_label = f"{qty} {uom}".strip()
        unit_usd = fmt_usd(ln.get("unit_price_usd"))
        sku = (ln.get("sku") or "").strip() or (ln.get("item_id") or "")
        amt = fmt_usd(ln.get("line_total_usd"))
        detail_html = ""
        if template_id == "detailed":
            detail_html = f'<div class="ldetail">{e(sku)} @ {e(unit_usd)} USD</div>'
        line_rows.append(
            f'<div class="line"><div class="lname">{e(name)}</div>{detail_html}'
            f'<div class="lmeta"><span>{e(qty_label)}</span><span class="mono">{e(amt)}</span></div></div>'
        )

    footer_html = f'<div class="footer">{e(footer_text)}</div>' if footer_text else ""
    company_html = f"<h1>{e(company_name)}</h1>" if (company_name and not hide_company_name) else ""
    vat_row_html = (
        f'<div class="row"><span class="muted">VAT USD</span><strong class="mono">{e(fmt_usd(totals.get("tax_usd")))}</strong></div>'
        if not hide_vat_reference
        else ""
    )
    balance_rows_html = ""
    if customer_balance:
        balance_rows_html = (
            f'<div class="row"><span class="muted">Prev Bal USD</span><strong class="mono">{e(fmt_usd(customer_balance.get("previous_usd")))}</strong></div>'
            f'<div class="row"><span class="muted">Prev Bal LBP</span><strong class="mono">{e(fmt_lbp(customer_balance.get("previous_lbp")))}</strong></div>'
            f'<div class="row"><span class="muted">After Sale USD</span><strong class="mono">{e(fmt_usd(customer_balance.get("after_usd")))}</strong></div>'
            f'<div class="row"><span class="muted">After Sale LBP</span><strong class="mono">{e(fmt_lbp(customer_balance.get("after_lbp")))}</strong></div>'
        )
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{e(title)}</title>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      body {{
        color: #000;
        font-family: "Roboto", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, "Noto Sans", sans-serif;
        font-size: 10px;
        font-weight: 700;
        overflow-x: hidden;
        padding: 0 15px;
        -webkit-print-color-adjust: exact;
      }}
      .mono {{ font-variant-numeric: tabular-nums; }}
      .muted {{ color: #000; }}
      h1 {{ font-size: 13px; margin-bottom: 1px; font-weight: 900; }}
      h2 {{ font-size: 11px; font-weight: 900; margin-bottom: 4px; }}
      .meta {{ font-size: 9px; line-height: 1.3; margin-bottom: 6px; }}
      .hdr {{ display: flex; justify-content: space-between; border-bottom: 1px solid #000; padding-bottom: 2px; margin-bottom: 2px; font-size: 9px; font-weight: 900; }}
      .line {{ border-bottom: 1px dashed #666; padding: 2px 0 3px; }}
      .lname {{ font-weight: 700; word-break: break-word; }}
      .ldetail {{ font-size: 8px; color: #000; }}
      .lmeta {{ display: flex; justify-content: space-between; font-size: 9px; color: #000; }}
      .totals {{ margin-top: 6px; font-size: 10px; }}
      .row {{ display: flex; justify-content: space-between; padding: 1px 0; }}
      .footer {{ margin-top: 6px; font-size: 8px; color: #000; text-align: center; }}
      .actions {{ margin-top: 8px; display: flex; gap: 6px; }}
      button {{
        border: 1px solid #ddd;
        background: white;
        padding: 6px 8px;
        border-radius: 8px;
        font-size: 10px;
        cursor: pointer;
      }}
      @media print {{
        @page {{ margin: 0; }}
        body {{ width: 100%; }}
        .actions {{ display: none; }}
      }}
    </style>
  </head>
  <body>
    {company_html}
    <h2>{e(title)}</h2>
    <div class="meta">
      {''.join(meta_rows)}
    </div>

    <div class="hdr"><span>Item</span><span>Qty / USD</span></div>
    {''.join(line_rows)}

    <div class="totals">
      <div class="row"><span class="muted">Subtotal</span><strong class="mono">{e(fmt_usd(totals.get("base_usd")))}</strong></div>
      {vat_row_html}
      <div class="row"><span class="muted">Total USD</span><strong class="mono">{e(fmt_usd(totals.get("total_usd")))}</strong></div>
      <div class="row"><span class="muted">Total LBP</span><strong class="mono">{e(fmt_lbp(totals.get("total_lbp")))}</strong></div>
      {balance_rows_html}
    </div>
    {footer_html}

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


def _receipt_text(
    receipt_row,
    width: Optional[int] = None,
    template_id: str = "classic",
    company_name: str = "AH Trading",
    footer_text: str = "",
    hide_company_name: bool = False,
    hide_vat_reference: bool = False,
) -> str:
    """
    Plain-text receipt for thermal printers via OS spooling.
    Keeps dependencies minimal (no HTML->PDF rendering).
    """
    if not receipt_row:
        return "No receipt yet.\n"

    template = _normalize_receipt_template_id(template_id)
    default_width = 34 if template == "compact" else 46
    try:
        width_chars = int(width) if width is not None else default_width
    except Exception:
        width_chars = default_width
    width_chars = max(16, min(64, width_chars))

    company_label = _clean_receipt_text(company_name, fallback="AH Trading", limit=64) or "AH Trading"
    footer_label = _clean_receipt_text(footer_text, fallback="", limit=160)

    r = receipt_row.get("receipt") or {}
    lines = r.get("lines") or []
    totals = r.get("totals") or {}
    customer_name = str(r.get("customer_name") or "").strip()
    customer_id = str(r.get("customer_id") or "").strip()
    customer_label = customer_name or customer_id or "-"
    customer_balance = r.get("customer_balance") if isinstance(r.get("customer_balance"), dict) else None

    def clip(s: str, limit: Optional[int] = None) -> str:
        lim = width_chars if limit is None else max(4, int(limit or width_chars))
        txt = " ".join(str(s or "").split())
        if len(txt) <= lim:
            return txt
        return txt[: max(0, lim - 3)] + "..."

    def fmt_qty(x):
        try:
            v = float(x or 0)
        except Exception:
            return "0"
        if abs(v - round(v)) < 1e-9:
            return str(int(round(v)))
        return f"{v:.3f}".rstrip("0").rstrip(".")

    def fmt_time(value):
        raw = str(value or "").strip()
        if not raw:
            return "-"
        probe = raw.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(probe)
            return dt.strftime("%Y-%m-%d %H:%M")
        except Exception:
            return raw.replace("T", " ")

    def short_id(value: str, keep: int = 6) -> str:
        s = str(value or "").strip()
        if len(s) <= (keep * 2 + 1):
            return s
        return f"{s[:keep]}...{s[-keep:]}"

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

    def push_rule(ch: str = "-"):
        out.append((ch or "-")[0] * width_chars)

    def push_center(value: str):
        txt = clip(value)
        if not txt:
            return
        pad = max(0, (width_chars - len(txt)) // 2)
        out.append((" " * pad) + txt)

    def push_aligned(left: str, right: str):
        left_s = clip(left)
        right_s = clip(right, width_chars)
        if not right_s:
            out.append(left_s)
            return
        if len(right_s) >= width_chars:
            out.append(left_s)
            out.append(right_s)
            return
        room = width_chars - len(right_s) - 1
        if room < 8:
            out.append(left_s)
            out.append(right_s)
            return
        out.append(left_s[:room] + " " + right_s)

    def push_wrapped(value: str, prefix: str = ""):
        text = clip(value, 320)
        if not text:
            return
        wrap_width = max(8, width_chars - len(prefix))
        wrapped = textwrap.wrap(
            text,
            width=wrap_width,
            break_long_words=False,
            break_on_hyphens=False,
        ) or [text]
        pad = " " * len(prefix)
        for idx, row in enumerate(wrapped):
            out.append(f"{prefix if idx == 0 else pad}{row}")

    out = []
    title = "SALE RECEIPT" if receipt_row.get("receipt_type") == "sale" else "RETURN RECEIPT"
    if company_label and not hide_company_name:
        push_center(company_label)
    push_center(title)
    push_rule("=")
    receipt_no = str(r.get("receipt_no") or r.get("invoice_no") or "").strip()
    if receipt_no:
        push_aligned("No", clip(receipt_no))
    push_aligned("Time", fmt_time(r.get("created_at")))
    if template != "compact":
        # Adapt truncation length to available width so IDs don't overflow.
        id_keep = max(3, min(6, (width_chars - 10) // 2))
        push_wrapped(f"Event: {short_id(r.get('event_id') or '-', keep=id_keep)}")
        if r.get("shift_id"):
            push_wrapped(f"Shift: {short_id(r.get('shift_id'), keep=id_keep)}")
    if r.get("cashier", {}).get("name") or r.get("cashier", {}).get("id"):
        push_aligned("Cashier", r.get('cashier', {}).get('name') or r.get('cashier', {}).get('id'))
    if customer_label and customer_label != "-":
        push_aligned("Customer", customer_label)
    if r.get("payment_method"):
        push_aligned("Payment", str(r.get('payment_method')).upper())
    push_rule("-")

    # Lines: item name plus qty x unit and line amount.
    for idx, ln in enumerate(lines, start=1):
        name = (ln.get("name") or "").strip() or (ln.get("sku") or "").strip() or ln.get("item_id") or ""
        qty_entered = ln.get("qty_entered")
        qty = qty_entered if qty_entered is not None else (ln.get("qty") or 0)
        uom = (ln.get("uom") or "").strip()
        qty_label = f"{fmt_qty(qty)} {uom}".strip()
        amt = fmt_usd(ln.get("line_total_usd"))
        unit = fmt_usd(ln.get("unit_price_usd"))
        push_wrapped(name, prefix=f"{idx:>2}. ")
        push_aligned(f"    {qty_label} x {unit}", f"{amt} USD")
        if template == "detailed":
            sku = (ln.get("sku") or "").strip() or (ln.get("item_id") or "")
            if sku:
                push_wrapped(f"SKU: {sku}", prefix="    ")
        out.append("")

    if not lines:
        out.append("No items")
        out.append("")

    push_rule("-")
    push_aligned("Subtotal USD", fmt_usd(totals.get('base_usd')))
    if not hide_vat_reference:
        push_aligned("VAT USD", fmt_usd(totals.get('tax_usd')))
    push_aligned("TOTAL USD", fmt_usd(totals.get('total_usd')))
    push_aligned("TOTAL LBP", fmt_lbp(totals.get('total_lbp')))
    if customer_balance:
        push_aligned("Prev Bal USD", fmt_usd(customer_balance.get('previous_usd')))
        push_aligned("Prev Bal LBP", fmt_lbp(customer_balance.get('previous_lbp')))
        push_aligned("After Bal USD", fmt_usd(customer_balance.get('after_usd')))
        push_aligned("After Bal LBP", fmt_lbp(customer_balance.get('after_lbp')))
    push_rule("=")
    if footer_label:
        for row in textwrap.wrap(
            footer_label,
            width=width_chars,
            break_long_words=False,
            break_on_hyphens=False,
        ):
            push_center(row)
        push_rule("=")
    out.append("")
    return "\n".join(out) + "\n"


def _escpos_encode(text: str, bold: bool = True) -> bytes:
    """
    Encode receipt text with ESC/POS control sequences for thermal printers.

    Maximises print darkness by stacking multiple emphasis modes:
      - ESC @       : initialise printer (reset to defaults)
      - ESC E 1     : bold (emphasized) mode
      - ESC G 1     : double-strike mode (prints each dot-line twice)
      - GS ! 0x01   : double-height characters for better readability
      - GS V 66 0   : partial cut after receipt
      - LF feed     : extra line feeds before cut for tear-off
    """
    buf = bytearray()
    # ESC @ — initialise / reset
    buf += b"\x1b\x40"
    if bold:
        # ESC E 1 — bold (emphasized) mode ON
        buf += b"\x1b\x45\x01"
        # ESC G 1 — double-strike mode ON (each line printed twice = darker)
        buf += b"\x1b\x47\x01"
    # Encode the receipt body (CP437 is the ESC/POS default codepage).
    try:
        buf += (text or "").encode("cp437", errors="replace")
    except Exception:
        buf += (text or "").encode("utf-8", errors="replace")
    # Turn modes off before footer commands
    if bold:
        buf += b"\x1b\x45\x00"  # bold off
        buf += b"\x1b\x47\x00"  # double-strike off
    # Feed a few lines then partial cut (GS V 66 0 = feed + partial cut).
    buf += b"\n\n\n\n"
    buf += b"\x1d\x56\x42\x00"
    return bytes(buf)


def _print_raw_win(text: str, printer_name: str, copies: int = 1, bold: bool = True) -> bool:
    """
    Send raw text to a Windows printer using the winspool.drv RAW datatype.
    This bypasses GDI font rendering and lets the printer use its built-in
    monospaced font — the correct approach for thermal/receipt printers.
    Returns True on success, False if the API calls fail.
    """
    ps = shutil.which("powershell") or shutil.which("pwsh")
    if not ps:
        return False

    def ps_sq(s: str) -> str:
        return "'" + str(s or "").replace("'", "''") + "'"

    # Encode receipt with ESC/POS commands (bold, init, cut).
    receipt_bytes = _escpos_encode(text, bold=bold)

    tmp = None
    try:
        tmp = tempfile.NamedTemporaryFile("wb", delete=False, suffix=".bin")
        for _ in range(max(1, copies)):
            tmp.write(receipt_bytes)
        tmp.flush()
        tmp.close()

        # PowerShell: use Add-Type to P/Invoke winspool.drv for RAW printing.
        script = f"""
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrint {{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DOCINFOW {{
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }}

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool StartDocPrinter(IntPtr hPrinter, int Level, ref DOCINFOW pDocInfo);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr hPrinter, byte[] pBuf, int cbBuf, out int pcWritten);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr hPrinter);

    public static bool Send(string printerName, byte[] data) {{
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
        var di = new DOCINFOW {{ pDocName = "POS Receipt", pOutputFile = null, pDataType = "RAW" }};
        if (!StartDocPrinter(hPrinter, 1, ref di)) {{ ClosePrinter(hPrinter); return false; }}
        StartPagePrinter(hPrinter);
        int written;
        WritePrinter(hPrinter, data, data.Length, out written);
        EndPagePrinter(hPrinter);
        EndDocPrinter(hPrinter);
        ClosePrinter(hPrinter);
        return true;
    }}
}}
'@
$data = [System.IO.File]::ReadAllBytes({ps_sq(tmp.name)})
$ok = [RawPrint]::Send({ps_sq(printer_name)}, $data)
if (-not $ok) {{ exit 1 }}
"""
        result = subprocess.run(
            [ps, "-NoProfile", "-Command", script],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20,
        )
        return result.returncode == 0
    except Exception:
        return False
    finally:
        try:
            if tmp and tmp.name and os.path.exists(tmp.name):
                os.unlink(tmp.name)
        except Exception:
            pass


def _print_text_to_printer(text: str, printer: Optional[str] = None, copies: int = 1):
    try:
        copies_i = int(copies or 1)
    except Exception:
        copies_i = 1
    copies_i = max(1, min(10, copies_i))

    # Windows: try RAW printing first (best for thermal/receipt printers),
    # then fall back to Out-Printer (GDI rendering).
    if sys.platform.startswith("win"):
        ps = shutil.which("powershell") or shutil.which("pwsh")
        if not ps:
            raise RuntimeError("Printing is not available: PowerShell not found")

        # Try raw printing first — thermal printers render their own font.
        if printer and _print_raw_win(text, printer, copies=copies_i):
            return

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

    # Try ESC/POS raw mode first (bold, auto-cut) — best for thermal printers.
    raw_tmp = None
    try:
        receipt_bytes = _escpos_encode(text, bold=True)
        raw_tmp = tempfile.NamedTemporaryFile("wb", delete=False, suffix=".bin")
        raw_tmp.write(receipt_bytes)
        raw_tmp.flush()
        raw_tmp.close()
        raw_cmd = [lp]
        if printer:
            raw_cmd += ["-d", str(printer)]
        if copies_i != 1:
            raw_cmd += ["-n", str(copies_i)]
        raw_cmd += ["-o", "raw", raw_tmp.name]
        subprocess.run(raw_cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=12)
        return  # raw ESC/POS succeeded
    except Exception:
        pass  # fall through to GDI/text mode
    finally:
        try:
            if raw_tmp and raw_tmp.name and os.path.exists(raw_tmp.name):
                os.unlink(raw_tmp.name)
        except Exception:
            pass

    # Fallback: plain-text mode with thermal-friendly CUPS options.
    tmp = None
    try:
        tmp = tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt", encoding="utf-8")
        tmp.write(text or "")
        tmp.flush()
        tmp.close()

        base_cmd = [lp]
        if printer:
            base_cmd += ["-d", str(printer)]
        if copies_i != 1:
            base_cmd += ["-n", str(copies_i)]

        # Try thermal-friendly CUPS options first, then fall back to plain lp.
        thermal_opts = [
            "page-left=0",
            "page-right=0",
            "page-top=0",
            "page-bottom=0",
            "cpi=12",
            "lpi=8",
        ]
        attempts = [thermal_opts, []]
        last_error = None
        for opts in attempts:
            cmd = list(base_cmd)
            for opt in opts:
                cmd += ["-o", opt]
            cmd.append(tmp.name)
            try:
                subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=12)
                last_error = None
                break
            except Exception as ex:
                last_error = ex
        if last_error is not None:
            raise last_error
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
            if not sumatra:
                for candidate in (
                    os.path.expandvars(r"%LOCALAPPDATA%\SumatraPDF\SumatraPDF.exe"),
                    os.path.expandvars(r"%PROGRAMFILES%\SumatraPDF\SumatraPDF.exe"),
                    os.path.expandvars(r"%PROGRAMFILES(X86)%\SumatraPDF\SumatraPDF.exe"),
                ):
                    if os.path.isfile(candidate):
                        sumatra = candidate
                        break
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
            # Wait for the print process to become idle (input-ready) or exit,
            # polling every 500ms up to 30s, instead of a fixed sleep.
            cmd = (
                f"for ($i=0; $i -lt {copies_i}; $i++) {{ "
                f"$p = Start-Process -FilePath {file_lit} -Verb PrintTo -ArgumentList {prn_lit} -PassThru; "
                f"$waited = 0; "
                f"while (!$p.HasExited -and $waited -lt 30000) {{ "
                f"  try {{ $p.WaitForInputIdle(500) | Out-Null }} catch {{}}; "
                f"  $waited += 500; "
                f"  Start-Sleep -Milliseconds 500 "
                f"}}; "
                f"if (!$p.HasExited) {{ try {{ $p.CloseMainWindow() | Out-Null }} catch {{}} }}; "
                f"Start-Sleep -Milliseconds 200 "
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
            SELECT event_id, event_type, payload_json, created_at, status, idempotency_key
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
            "idempotency_key": (r["idempotency_key"] if r["idempotency_key"] else None),
        }


def _require_print_base_url(cfg: dict) -> str:
    bases = _print_base_candidates(cfg)
    if not bases:
        raise ValueError("missing print_base_url (Admin URL)")
    return bases[0]


def _admin_base_from_api_base(value) -> str:
    base = _normalize_api_base_url(value)
    if not base:
        return ""
    try:
        u = urlparse(base)
    except Exception:
        return base
    path = str(u.path or "").rstrip("/")
    lower = path.lower()
    if lower.endswith("/api"):
        path = path[:-4]
    else:
        idx = lower.find("/api/")
        if idx >= 0:
            path = path[:idx]
    return u._replace(path=(path or "/"), params="", query="", fragment="").geturl().rstrip("/")


def _print_base_candidates(cfg: dict) -> list[str]:
    out: list[str] = []

    def _add(value) -> None:
        base = _normalize_api_base_url(value)
        if not base:
            return
        if base not in out:
            out.append(base)

    _add(cfg.get("print_base_url"))
    _add(_admin_base_from_api_base(cfg.get("cloud_api_base_url") or cfg.get("api_base_url") or cfg.get("edge_api_base_url")))
    _add(_admin_base_from_api_base(cfg.get("api_base_url")))
    return out


def _fetch_invoice_pdf(cfg: dict, invoice_id: str, template: Optional[str] = None) -> bytes:
    """
    Fetch the A4 invoice PDF from the Admin app exports route using device headers.
    """
    invoice_id = (invoice_id or "").strip()
    if not invoice_id:
        raise ValueError("missing invoice_id")

    tpl = _effective_invoice_template_id(
        template if template is not None else cfg.get("invoice_template"),
        cfg.get("company_id"),
    )
    bases = _print_base_candidates(cfg)
    if not bases:
        raise ValueError("missing print_base_url (Admin URL)")
    last_err: Optional[str] = None
    for base in bases:
        url = f"{base}/exports/sales-invoices/{quote(invoice_id)}/pdf?inline=1&template={quote(tpl)}"
        req = Request(url, headers={**device_headers(cfg), "Accept": "application/pdf"}, method="GET")
        try:
            with urlopen(req, timeout=20) as resp:
                return resp.read()
        except Exception as ex:
            last_err = str(ex)
            continue
    raise ValueError(f"invoice PDF fetch failed for all Admin URL candidates: {last_err or 'unknown error'}")


def _resolve_sales_invoice_from_event(cfg: dict, event_id: str) -> dict:
    """
    Ensure the event exists on the cloud API, process it now, and return invoice identifiers.
    Returns: {invoice_id, invoice_no, sync}
    """
    base = _require_api_base(cfg)
    company_id = (cfg.get("company_id") or "").strip()
    device_id = (cfg.get("device_id") or "").strip()
    if not company_id or not device_id or not (cfg.get("device_token") or "").strip():
        raise ValueError("missing device credentials")

    ev = _get_outbox_event(event_id)
    if not ev:
        raise ValueError("event not found in local outbox")

    # Ensure the API has this event (idempotent).
    bundle = {
        "company_id": company_id,
        "device_id": device_id,
        "events": [
            {"event_id": ev["event_id"], "event_type": ev["event_type"], "payload": ev["payload"], "created_at": ev["created_at"]},
        ],
    }
    post_json(f"{base.rstrip('/')}/pos/outbox/submit", bundle, headers=device_headers(cfg))

    def _extract_invoice_id(payload) -> str:
        if not isinstance(payload, dict):
            return ""

        def dig(obj, *path):
            cur = obj
            for key in path:
                if not isinstance(cur, dict):
                    return ""
                cur = cur.get(key)
            return str(cur or "").strip()

        candidates = [
            dig(payload, "invoice_id"),
            dig(payload, "invoice", "id"),
            dig(payload, "sale", "invoice", "id"),
            dig(payload, "result", "invoice_id"),
            dig(payload, "result", "invoice", "id"),
            dig(payload, "process", "invoice_id"),
            dig(payload, "process", "invoice", "id"),
            dig(payload, "process", "sale", "invoice", "id"),
            dig(payload, "submit", "invoice_id"),
            dig(payload, "submit", "invoice", "id"),
            dig(payload, "data", "invoice_id"),
            dig(payload, "data", "invoice", "id"),
            dig(payload, "event", "invoice_id"),
            dig(payload, "event", "invoice", "id"),
        ]
        for value in candidates:
            if value:
                return value
        return ""

    res = {}
    inv_id = ""
    inv_no = ""
    # Invoice creation can be briefly eventual right after submit/process.
    for delay_s in (0.0, 0.22, 0.52, 1.0):
        if delay_s > 0:
            time.sleep(delay_s)
        res = post_json(
            f"{base.rstrip('/')}/pos/outbox/process-one",
            {"event_id": ev["event_id"]},
            headers=device_headers(cfg),
        )
        inv_id = _extract_invoice_id(res)
        inv_no = str(res.get("invoice_no") or "").strip()
        if inv_id:
            break
        # Best-effort fallback for API variants that expose invoice lookup by event.
        by_event_url = f"{base.rstrip('/')}/pos/sales-invoices/by-event/{quote(ev['event_id'])}"
        by_event, _status, _detail = _setup_req_json_safe(
            by_event_url,
            method="GET",
            headers=device_headers(cfg),
            timeout_s=8.0,
        )
        if by_event is not None:
            inv_id = _extract_invoice_id(by_event)
            if inv_id and not inv_no:
                inv_no = str((by_event.get("invoice") or {}).get("invoice_no") or by_event.get("invoice_no") or "").strip()
            if inv_id:
                break
    if not inv_id:
        raise ValueError("invoice is still being generated; retry in a few seconds")
    # Keep "edge" as an alias for older callers.
    return {"invoice_id": inv_id, "invoice_no": (inv_no or None), "sync": res, "edge": res}


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
    Returns: (cashier dict | None, error_code string).
    error_code: "", "not_assigned", "invalid_device", "invalid_pin"
    """
    pin = (pin or "").strip()
    if not pin:
        return None, ""
    if not (cfg.get("device_id") and cfg.get("device_token")):
        return None, "invalid_device"
    try:
        base = _require_api_base(cfg)
    except Exception:
        base = ""
    if not base:
        return None, "invalid_device"
    try:
        res = post_json(f"{base}/pos/cashiers/verify", {"pin": pin}, headers=device_headers(cfg))
        cashier = (res or {}).get("cashier") or None
        if not cashier:
            return None, "invalid_pin"
        # Refresh cache so we can verify offline next time.
        try:
            cashiers = fetch_json(f"{base}/pos/cashiers/catalog", headers=device_headers(cfg))
            upsert_cashiers(cashiers.get("cashiers", []))
        except URLError:
            pass
        return {"id": cashier.get("id"), "name": cashier.get("name")}, ""
    except HTTPError as ex:
        detail = ""
        try:
            raw = ex.read().decode("utf-8")
            payload = json.loads(raw) if raw else {}
            detail = str((payload or {}).get("detail") or (payload or {}).get("error") or "").strip().lower()
        except Exception:
            detail = ""
        if int(getattr(ex, "code", 0) or 0) == 403 and "not assigned" in detail:
            return None, "not_assigned"
        if int(getattr(ex, "code", 0) or 0) == 401:
            if "device token" in detail or "missing device" in detail:
                return None, "invalid_device"
            if "invalid pin" in detail:
                return None, "invalid_pin"
        return None, ""
    except URLError:
        return None, ""


def upsert_catalog(items):
    def _norm_uom_code(v, fallback="pcs"):
        u = str(v or "").strip()
        return u or str(fallback or "pcs").strip() or "pcs"

    def _to_pos_factor(v, fallback=1.0):
        try:
            f = float(v)
        except Exception:
            f = float(fallback or 1.0)
        if not math.isfinite(f) or f <= 0:
            f = float(fallback or 1.0)
        return f

    def _catalog_uom_rows(it):
        item_id = str(it.get("id") or "").strip()
        if not item_id:
            return []
        base_uom = _norm_uom_code(it.get("unit_of_measure"), "pcs")
        rows = []
        seen_uom_factor = set()

        # Real barcode rows first (keeps scan behavior intact).
        for idx, b in enumerate((it.get("barcodes") or []), start=1):
            if not isinstance(b, dict):
                continue
            uom = _norm_uom_code(b.get("uom_code"), base_uom)
            factor = _to_pos_factor(b.get("qty_factor"), 1.0)
            bf_key = (uom.upper(), round(factor, 6))
            seen_uom_factor.add(bf_key)
            barcode = str(b.get("barcode") or "").strip() or None
            bid = str(b.get("id") or "").strip() or f"bc-{item_id}-{idx}-{uom}-{factor:.6f}"
            rows.append(
                {
                    "id": bid,
                    "item_id": item_id,
                    "barcode": barcode,
                    "qty_factor": factor,
                    "uom_code": uom,
                    "label": (str(b.get("label") or "").strip() or None),
                    "is_primary": bool(b.get("is_primary")),
                }
            )

        # Then add conversion-only UOMs as non-scannable options.
        for conv in (it.get("uom_conversions") or []):
            if not isinstance(conv, dict):
                continue
            if conv.get("is_active") is False:
                continue
            uom = _norm_uom_code(conv.get("uom_code") or conv.get("uom"), base_uom)
            factor = _to_pos_factor(conv.get("qty_factor") if "qty_factor" in conv else conv.get("to_base_factor"), 1.0)
            bf_key = (uom.upper(), round(factor, 6))
            if bf_key in seen_uom_factor:
                continue
            seen_uom_factor.add(bf_key)
            rows.append(
                {
                    "id": str(conv.get("id") or "").strip() or f"uom-{item_id}-{uom}",
                    "item_id": item_id,
                    "barcode": None,
                    "qty_factor": factor,
                    "uom_code": uom,
                    "label": (str(conv.get("label") or "").strip() or uom),
                    "is_primary": (uom.upper() == base_uom.upper() and abs(factor - 1.0) < 1e-9),
                }
            )

        # Guardrail: always keep base UOM selectable.
        base_key = (base_uom.upper(), 1.0)
        if base_key not in seen_uom_factor:
            rows.append(
                {
                    "id": f"uom-{item_id}-{base_uom}-base",
                    "item_id": item_id,
                    "barcode": None,
                    "qty_factor": 1.0,
                    "uom_code": base_uom,
                    "label": base_uom,
                    "is_primary": True,
                }
            )

        return rows

    with db_connect() as conn:
        cur = conn.cursor()
        for it in items:
            updated_at = it.get("changed_at") or it.get("updated_at") or datetime.now(timezone.utc).isoformat()
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
            # Multi-barcodes / pack factors (+ conversion-only UOM options).
            for b in _catalog_uom_rows(it):
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
                        b.get("id"),
                        b.get("item_id"),
                        b.get("barcode"),
                        float(b.get("qty_factor") or 1),
                        b.get("uom_code"),
                        b.get("label"),
                        1 if b.get("is_primary") else 0,
                        datetime.now(timezone.utc).isoformat(),
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
                    datetime.now(timezone.utc).date().isoformat(),
                ),
            )
        conn.commit()


def upsert_categories(categories):
    with db_connect() as conn:
        cur = conn.cursor()
        for c in categories or []:
            updated_at = c.get("changed_at") or c.get("updated_at") or datetime.now(timezone.utc).isoformat()
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
    created_at = datetime.now(timezone.utc).isoformat()
    add_outbox_event_record(
        event_id,
        event_type,
        payload,
        created_at,
        status="pending",
        idempotency_key=None,
    )
    return event_id


def get_outbox_event_by_idempotency(event_type: str, idempotency_key: str):
    et = str(event_type or "").strip()
    ik = str(idempotency_key or "").strip()
    if not et or not ik:
        return None
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT event_id, event_type, created_at, status, idempotency_key
            FROM pos_outbox_events
            WHERE event_type = ? AND idempotency_key = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (et, ik),
        )
        row = cur.fetchone()
        if not row:
            return None
        return dict(row)


def add_outbox_event_record(event_id, event_type, payload, created_at, status="pending", idempotency_key=None):
    event_id = str(event_id or "").strip() or str(uuid.uuid4())
    created_at = str(created_at or "").strip() or datetime.now(timezone.utc).isoformat()
    st = str(status or "pending").strip().lower()
    if st not in {"pending", "acked"}:
        st = "pending"
    idem = str(idempotency_key or "").strip() or None
    with db_connect() as conn:
        cur = conn.cursor()
        try:
            cur.execute(
                """
                INSERT INTO pos_outbox_events (event_id, event_type, payload_json, created_at, status, idempotency_key)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (event_id, event_type, json.dumps(payload), created_at, st, idem),
            )
        except sqlite3.IntegrityError:
            # Duplicate idempotency key for this event type: treat as replay.
            if idem:
                existing = get_outbox_event_by_idempotency(event_type, idem)
                if existing and existing.get("event_id"):
                    return str(existing["event_id"]), False
            raise
        conn.commit()
    return event_id, True


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
            LIMIT 500
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


def add_audit_log(
    action: str,
    *,
    company_id=None,
    cashier_id=None,
    shift_id=None,
    event_id=None,
    status=None,
    details=None,
):
    act = str(action or "").strip()
    if not act:
        return
    created_at = datetime.now(timezone.utc).isoformat()
    det = None
    if details is not None:
        try:
            det = json.dumps(details)
        except Exception:
            det = json.dumps({"raw": str(details)})
    with db_connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO pos_audit_log (created_at, action, company_id, cashier_id, shift_id, event_id, status, details_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                created_at,
                act,
                str(company_id or "").strip() or None,
                str(cashier_id or "").strip() or None,
                str(shift_id or "").strip() or None,
                str(event_id or "").strip() or None,
                str(status or "").strip() or None,
                det,
            ),
        )
        conn.commit()


def list_audit_logs(limit: int = 200):
    lim = max(1, min(1000, int(limit or 200)))
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, created_at, action, company_id, cashier_id, shift_id, event_id, status, details_json
            FROM pos_audit_log
            ORDER BY id DESC
            LIMIT ?
            """,
            (lim,),
        )
        rows = []
        for r in cur.fetchall():
            row = dict(r)
            det_raw = row.get("details_json")
            if det_raw:
                try:
                    row["details"] = json.loads(det_raw)
                except Exception:
                    row["details"] = {"raw": str(det_raw)}
            else:
                row["details"] = None
            row.pop("details_json", None)
            rows.append(row)
        return rows


CART_DRAFTS_MAX = 50


def get_cart_drafts(cashier_id: str = ""):
    """Return drafts. If cashier_id is given, filter by it; otherwise return all."""
    cid = (cashier_id or "").strip()
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        if cid:
            cur.execute(
                """
                SELECT id, cashier_id, name, draft_json, created_at, updated_at
                FROM pos_cart_drafts
                WHERE cashier_id = ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (cid, CART_DRAFTS_MAX),
            )
        else:
            cur.execute(
                """
                SELECT id, cashier_id, name, draft_json, created_at, updated_at
                FROM pos_cart_drafts
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (CART_DRAFTS_MAX,),
            )
        rows = []
        for r in cur.fetchall():
            row = dict(r)
            raw = row.pop("draft_json", "{}")
            try:
                row["draft"] = json.loads(raw)
            except Exception:
                row["draft"] = {}
            rows.append(row)
        return rows


def upsert_cart_draft(draft_id: str, cashier_id: str, name: str, draft_json: str,
                      created_at: str, updated_at: str):
    did = (draft_id or "").strip()
    cid = (cashier_id or "").strip()
    if not did:
        return False
    with db_connect() as conn:
        conn.execute(
            """
            INSERT INTO pos_cart_drafts (id, cashier_id, name, draft_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              draft_json = excluded.draft_json,
              updated_at = excluded.updated_at
            """,
            (did, cid, (name or "").strip(), draft_json, created_at, updated_at),
        )
        # Enforce global limit: keep newest CART_DRAFTS_MAX, delete the rest.
        conn.execute(
            """
            DELETE FROM pos_cart_drafts
            WHERE id NOT IN (
              SELECT id FROM pos_cart_drafts
              ORDER BY updated_at DESC
              LIMIT ?
            )
            """,
            (CART_DRAFTS_MAX,),
        )
    return True


def delete_cart_draft(draft_id: str):
    did = (draft_id or "").strip()
    if not did:
        return False
    with db_connect() as conn:
        conn.execute("DELETE FROM pos_cart_drafts WHERE id = ?", (did,))
    return True


def delete_all_cart_drafts_for_cashier(cashier_id: str):
    cid = (cashier_id or "").strip()
    if not cid:
        return 0
    with db_connect() as conn:
        cur = conn.execute("DELETE FROM pos_cart_drafts WHERE cashier_id = ?", (cid,))
        return cur.rowcount


def _sale_payload_totals(payload: dict) -> dict:
    data = payload if isinstance(payload, dict) else {}
    lines = data.get("lines") if isinstance(data.get("lines"), list) else []
    subtotal_usd = 0.0
    subtotal_lbp = 0.0
    for ln in lines:
        if not isinstance(ln, dict):
            continue
        try:
            subtotal_usd += float(ln.get("line_total_usd") or 0)
        except Exception:
            pass
        try:
            subtotal_lbp += float(ln.get("line_total_lbp") or 0)
        except Exception:
            pass

    tax = data.get("tax") if isinstance(data.get("tax"), dict) else {}
    try:
        tax_usd = float(tax.get("tax_usd") or 0)
    except Exception:
        tax_usd = 0.0
    try:
        tax_lbp = float(tax.get("tax_lbp") or 0)
    except Exception:
        tax_lbp = 0.0

    total_usd = subtotal_usd + tax_usd
    total_lbp = subtotal_lbp + tax_lbp
    return {
        "subtotal_usd": round(subtotal_usd, 2),
        "subtotal_lbp": int(round(subtotal_lbp)),
        "tax_usd": round(tax_usd, 2),
        "tax_lbp": int(round(tax_lbp)),
        "total_usd": round(total_usd, 2),
        "total_lbp": int(round(total_lbp)),
        "line_count": len(lines),
    }


def _return_payload_totals(payload: dict) -> dict:
    data = payload if isinstance(payload, dict) else {}
    lines = data.get("lines") if isinstance(data.get("lines"), list) else []
    subtotal_usd = 0.0
    subtotal_lbp = 0.0
    for ln in lines:
        if not isinstance(ln, dict):
            continue
        try:
            subtotal_usd += float(ln.get("line_total_usd") or 0)
        except Exception:
            pass
        try:
            subtotal_lbp += float(ln.get("line_total_lbp") or 0)
        except Exception:
            pass

    tax = data.get("tax") if isinstance(data.get("tax"), dict) else {}
    try:
        tax_usd = float(tax.get("tax_usd") or 0)
    except Exception:
        tax_usd = 0.0
    try:
        tax_lbp = float(tax.get("tax_lbp") or 0)
    except Exception:
        tax_lbp = 0.0
    try:
        fee_usd = float(data.get("restocking_fee_usd") or 0)
    except Exception:
        fee_usd = 0.0
    try:
        fee_lbp = float(data.get("restocking_fee_lbp") or 0)
    except Exception:
        fee_lbp = 0.0
    total_usd = max(0.0, subtotal_usd + tax_usd - fee_usd)
    total_lbp = max(0.0, subtotal_lbp + tax_lbp - fee_lbp)
    return {
        "subtotal_usd": round(subtotal_usd, 2),
        "subtotal_lbp": int(round(subtotal_lbp)),
        "tax_usd": round(tax_usd, 2),
        "tax_lbp": int(round(tax_lbp)),
        "restocking_fee_usd": round(fee_usd, 2),
        "restocking_fee_lbp": int(round(fee_lbp)),
        "total_usd": round(total_usd, 2),
        "total_lbp": int(round(total_lbp)),
        "line_count": len(lines),
    }


def _empty_return_summary() -> dict:
    return {
        "refund_count": 0,
        "refunded_total_usd": 0.0,
        "refunded_total_lbp": 0,
    }


def _merge_return_summary(target: dict, add: dict) -> dict:
    out = target if isinstance(target, dict) else _empty_return_summary()
    out["refund_count"] = int(out.get("refund_count") or 0) + int(add.get("refund_count") or 0)
    out["refunded_total_usd"] = round(float(out.get("refunded_total_usd") or 0) + float(add.get("refunded_total_usd") or 0), 2)
    out["refunded_total_lbp"] = int(round(float(out.get("refunded_total_lbp") or 0) + float(add.get("refunded_total_lbp") or 0)))
    return out


def list_shift_invoice_events(shift_id: str = "", limit: int = 120):
    lim = max(1, min(500, int(limit or 120)))
    shift = str(shift_id or "").strip()
    fetch_lim = max(lim * 4, 120)
    out = []
    seen_events = set()
    returns_by_event = {}
    cashier_name_by_id = {}
    customer_name_by_id = {}
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        if shift:
            cur.execute(
                """
                SELECT id, created_at, action, company_id, cashier_id, shift_id, event_id, status, details_json
                FROM pos_audit_log
                WHERE action = 'sale.submit' AND shift_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (shift, fetch_lim),
            )
        else:
            cur.execute(
                """
                SELECT id, created_at, action, company_id, cashier_id, shift_id, event_id, status, details_json
                FROM pos_audit_log
                WHERE action = 'sale.submit'
                ORDER BY id DESC
                LIMIT ?
                """,
                (fetch_lim,),
            )
        rows = cur.fetchall()
        cur.execute(
            """
            SELECT id, name
            FROM local_cashiers_cache
            ORDER BY name
            """
        )
        for cr in cur.fetchall():
            cid = str(cr["id"] or "").strip()
            if not cid:
                continue
            cashier_name_by_id[cid] = str(cr["name"] or "").strip() or cid

        cur.execute(
            """
            SELECT id, name
            FROM local_customers_cache
            ORDER BY name
            """
        )
        for rr in cur.fetchall():
            cid = str(rr["id"] or "").strip()
            if not cid:
                continue
            customer_name_by_id[cid] = str(rr["name"] or "").strip() or cid

        cur.execute(
            """
            SELECT event_id, payload_json, status, created_at
            FROM pos_outbox_events
            WHERE event_type = 'sale.returned'
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (max(fetch_lim * 6, 300),),
        )
        return_rows = cur.fetchall()
        for rr in return_rows:
            payload = {}
            try:
                payload = json.loads(rr["payload_json"] or "{}")
            except Exception:
                payload = {}
            if not isinstance(payload, dict):
                continue
            payload_shift = str(payload.get("shift_id") or "").strip()
            if shift and payload_shift and payload_shift != shift:
                continue
            receipt_meta = payload.get("receipt_meta") if isinstance(payload.get("receipt_meta"), dict) else {}
            source_event_id = str(receipt_meta.get("source_invoice_event_id") or "").strip()
            if not source_event_id:
                continue
            ret_totals = _return_payload_totals(payload)
            summary_add = {
                "refund_count": 1,
                "refunded_total_usd": float(ret_totals.get("total_usd") or 0),
                "refunded_total_lbp": int(ret_totals.get("total_lbp") or 0),
            }
            current = returns_by_event.get(source_event_id) or _empty_return_summary()
            returns_by_event[source_event_id] = _merge_return_summary(current, summary_add)

    for r in rows:
        event_id = str(r["event_id"] or "").strip()
        if not event_id or event_id in seen_events:
            continue
        seen_events.add(event_id)

        details = None
        try:
            details = json.loads(r["details_json"]) if r["details_json"] else None
        except Exception:
            details = None
        details = details if isinstance(details, dict) else {}
        payload = {}
        outbox_status = None
        outbox = _get_outbox_event(event_id)
        if isinstance(outbox, dict):
            payload = outbox.get("payload") if isinstance(outbox.get("payload"), dict) else {}
            outbox_status = str(outbox.get("status") or "").strip() or None

        totals = _sale_payload_totals(payload)
        receipt_meta = payload.get("receipt_meta") if isinstance(payload.get("receipt_meta"), dict) else {}
        pilot_meta = receipt_meta.get("pilot") if isinstance(receipt_meta.get("pilot"), dict) else {}
        cashier_id = str(r["cashier_id"] or payload.get("cashier_id") or "").strip()
        customer_id = str(payload.get("customer_id") or pilot_meta.get("customer_id_applied") or "").strip()
        cashier_name = cashier_name_by_id.get(cashier_id) if cashier_id else None
        customer_name = customer_name_by_id.get(customer_id) if customer_id else None
        payment_method = str(details.get("payment_method") or "").strip().lower()
        if not payment_method:
            payments = payload.get("payments") if isinstance(payload.get("payments"), list) else []
            if payments and isinstance(payments[0], dict):
                payment_method = str(payments[0].get("method") or "").strip().lower()
            if not payment_method:
                payment_method = "credit" if not payments else "cash"

        refund_summary = returns_by_event.get(event_id) or _empty_return_summary()
        total_usd = float(totals.get("total_usd") or 0)
        total_lbp = int(totals.get("total_lbp") or 0)
        refunded_usd = float(refund_summary.get("refunded_total_usd") or 0)
        refunded_lbp = int(refund_summary.get("refunded_total_lbp") or 0)
        refund_count = int(refund_summary.get("refund_count") or 0)
        if refund_count <= 0:
            refund_status = "none"
        elif (total_usd > 0 and refunded_usd >= (total_usd - 0.01)) or (total_usd <= 0 and total_lbp > 0 and refunded_lbp >= max(0, total_lbp - 1)) or (total_usd <= 0 and total_lbp <= 0 and (refunded_usd > 0 or refunded_lbp > 0)):
            refund_status = "refunded"
        else:
            refund_status = "partial"

        out.append(
            {
                "audit_id": int(r["id"]),
                "created_at": r["created_at"],
                "company_id": r["company_id"],
                "cashier_id": (cashier_id or None),
                "cashier_name": (cashier_name or None),
                "customer_id": (customer_id or None),
                "customer_name": (customer_name or None),
                "shift_id": r["shift_id"],
                "event_id": event_id,
                "status": (outbox_status or str(r["status"] or "").strip() or "unknown"),
                "audit_status": (str(r["status"] or "").strip() or None),
                "outbox_status": outbox_status,
                "payment_method": payment_method or None,
                "line_count": int(totals.get("line_count") or 0),
                "subtotal_usd": float(totals.get("subtotal_usd") or 0),
                "subtotal_lbp": int(totals.get("subtotal_lbp") or 0),
                "tax_usd": float(totals.get("tax_usd") or 0),
                "tax_lbp": int(totals.get("tax_lbp") or 0),
                "total_usd": total_usd,
                "total_lbp": total_lbp,
                "refund_count": refund_count,
                "refunded_total_usd": refunded_usd,
                "refunded_total_lbp": refunded_lbp,
                "refund_status": refund_status,
            }
        )
        if len(out) >= lim:
            break
    return out


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
    if vat_rate or has_vat_codes:
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
                    "tax_date": datetime.now(timezone.utc).date().isoformat(),
                }
            )
            tax_usd += t_usd
            tax_lbp += t_lbp

        if base_by:
            tax_code_for_block = default_tax_code_id or (next(iter(base_by.keys()), None))
            tax_block = {
                'tax_code_id': tax_code_for_block,
                'base_usd': base_usd,
                'base_lbp': base_lbp,
                'tax_usd': tax_usd,
                'tax_lbp': tax_lbp,
                'tax_date': datetime.now(timezone.utc).date().isoformat()
            }

    total_usd = _round_usd(base_usd + tax_usd)
    total_lbp = _round_lbp(base_lbp + tax_lbp)

    settlement_currency = (pricing_currency or 'USD').upper()
    payments = []
    if payment_method == 'credit':
        payments.append({'method': 'credit', 'amount_usd': 0, 'amount_lbp': 0})
    else:
        # `pos_processor` treats USD/LBP values as tender buckets. Sending both full totals
        # doubles the applied payment and can trigger overpayment guards on cloud processing.
        if settlement_currency == 'LBP':
            payments.append({'method': payment_method or 'cash', 'amount_usd': 0, 'amount_lbp': total_lbp})
        else:
            payments.append({'method': payment_method or 'cash', 'amount_usd': total_usd, 'amount_lbp': 0})

    loyalty_rate = float(config.get('loyalty_rate') or 0)
    loyalty_points = base_usd * loyalty_rate if loyalty_rate > 0 else 0

    return {
        'invoice_no': None,
        'exchange_rate': exchange_rate,
        'pricing_currency': pricing_currency,
        'settlement_currency': settlement_currency,
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
    if vat_rate or has_vat_codes:
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
                    "tax_date": datetime.now(timezone.utc).date().isoformat(),
                }
            )
            tax_usd += t_usd
            tax_lbp += t_lbp

        if base_by:
            tax_code_for_block = default_tax_code_id or (next(iter(base_by.keys()), None))
            tax_block = {
                'tax_code_id': tax_code_for_block,
                'base_usd': base_usd,
                'base_lbp': base_lbp,
                'tax_usd': tax_usd,
                'tax_lbp': tax_lbp,
                'tax_date': datetime.now(timezone.utc).date().isoformat()
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

    def _handle_cloud_proxy(self, parsed, method="GET"):
        """Proxy cloud POS API requests to avoid browser CORS restrictions.

        The browser sends:
          X-Cloud-Base-Url: target cloud API base (e.g. https://app.melqard.com/api)
          X-Device-Id / X-Device-Token: device credentials
        The agent forwards the request server-side and returns the response.
        """
        cloud_base = (self.headers.get("X-Cloud-Base-Url") or "").strip().rstrip("/")
        device_id = (self.headers.get("X-Device-Id") or "").strip()
        device_token = (self.headers.get("X-Device-Token") or "").strip()

        if not cloud_base:
            json_response(self, {"error": "X-Cloud-Base-Url header is required"}, status=400)
            return
        if not cloud_base.startswith("https://"):
            # Allow http only for localhost/dev; block arbitrary http targets.
            if "localhost" not in cloud_base and "127.0.0.1" not in cloud_base:
                json_response(self, {"error": "Cloud base URL must use HTTPS"}, status=400)
                return

        # Strip the /api/cloud-pos/ prefix to get the downstream path.
        sub_path = parsed.path[len("/api/cloud-pos/"):]
        qs = parsed.query
        target_url = f"{cloud_base}/{sub_path}"
        if qs:
            target_url += f"?{qs}"

        fwd_headers = {"Content-Type": "application/json"}
        if device_id:
            fwd_headers["X-Device-Id"] = device_id
        if device_token:
            fwd_headers["X-Device-Token"] = device_token

        body_data = None
        if method == "POST":
            length = int(self.headers.get("Content-Length", 0))
            if length > 0:
                body_data = self.rfile.read(length)

        try:
            req = Request(target_url, data=body_data, headers=fwd_headers, method=method)
            with urlopen(req, timeout=20) as resp:
                resp_body = resp.read()
                resp_status = resp.status
        except HTTPError as ex:
            resp_body = ex.read()
            resp_status = ex.code
        except (URLError, OSError) as ex:
            json_response(self, {"error": "cloud_unreachable", "detail": str(ex)}, status=502)
            return

        self.send_response(resp_status)
        self.send_header("Content-Type", "application/json")
        _maybe_send_cors_headers(self)
        self.end_headers()
        self.wfile.write(resp_body)

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
            cfg = load_config()
            row = get_last_receipt()
            text_response(self, _receipt_html(row, cfg=cfg), status=200, content_type="text/html")
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
            qs = parse_qs(parsed.query)
            force = str(qs.get("refresh", [""])[0]).strip().lower() in ("1", "true")
            json_response(self, list_system_printers(force_refresh=force))
            return
        if parsed.path in {"/api/sync/status", "/api/edge/status"}:
            st = edge_health(cfg, timeout_s=0.8)
            auth = edge_auth_check(cfg, timeout_s=1.2)
            sync_ok = bool(st.get("ok"))
            sync_latency_ms = st.get("latency_ms")
            sync_url = (st.get("url") or "")
            sync_error = st.get("error")
            sync_auth_ok = bool(auth.get("ok"))
            sync_auth_status = auth.get("status")
            sync_auth_latency_ms = auth.get("latency_ms")
            sync_auth_url = (auth.get("url") or "")
            sync_auth_error = auth.get("error")
            json_response(
                self,
                {
                    "ok": True,
                    "mode": st.get("mode") or auth.get("mode") or None,
                    "active_base_url": st.get("active_base_url") or auth.get("active_base_url") or None,
                    "sync_api_base_url": st.get("sync_api_base_url") or auth.get("sync_api_base_url") or None,
                    "edge_api_base_url": st.get("edge_api_base_url") or None,
                    "cloud_api_base_url": st.get("cloud_api_base_url") or None,
                    "resolve_detail": st.get("detail") or auth.get("detail") or None,
                    # New sync-* keys.
                    "sync_ok": sync_ok,
                    "sync_latency_ms": sync_latency_ms,
                    "sync_url": sync_url,
                    "sync_error": sync_error,
                    "sync_auth_ok": sync_auth_ok,
                    "sync_auth_status": sync_auth_status,
                    "sync_auth_latency_ms": sync_auth_latency_ms,
                    "sync_auth_url": sync_auth_url,
                    "sync_auth_error": sync_auth_error,
                    # Legacy edge-* keys kept for launcher compatibility.
                    "edge_ok": sync_ok,
                    "edge_latency_ms": sync_latency_ms,
                    "edge_url": sync_url,
                    "edge_error": sync_error,
                    "edge_auth_ok": sync_auth_ok,
                    "edge_auth_status": sync_auth_status,
                    "edge_auth_latency_ms": sync_auth_latency_ms,
                    "edge_auth_url": sync_auth_url,
                    "edge_auth_error": sync_auth_error,
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
        if parsed.path == "/api/receipts/templates":
            json_response(
                self,
                {
                    "templates": _receipt_templates_payload(),
                    "selected": _normalize_receipt_template_id(cfg.get("receipt_template")),
                },
            )
            return
        if parsed.path == "/api/invoices/templates":
            json_response(
                self,
                {
                    "templates": _invoice_templates_payload(),
                    "selected": _effective_invoice_template_id(cfg.get("invoice_template"), cfg.get("company_id")),
                },
            )
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
        if parsed.path == "/api/audit":
            limit_raw = (parse_qs(parsed.query).get("limit") or ["200"])[0]
            try:
                limit_i = int(limit_raw or "200")
            except Exception:
                limit_i = 200
            json_response(self, {"audit": list_audit_logs(limit_i)})
            return
        if parsed.path == "/api/outbox/event":
            event_id = (parse_qs(parsed.query).get("event_id") or [""])[0].strip()
            if not event_id:
                json_response(self, {"error": "event_id is required"}, status=400)
                return
            ev = _get_outbox_event(event_id)
            if not ev:
                json_response(self, {"error": "event not found", "event_id": event_id}, status=404)
                return
            json_response(self, {"event": ev})
            return
        if parsed.path == "/api/drafts":
            qs = parse_qs(parsed.query)
            cashier_id = (qs.get("cashier_id") or [""])[0].strip()
            rows = get_cart_drafts(cashier_id)
            json_response(self, {"drafts": rows})
            return

        # Cloud proxy: forward browser requests to cloud API to avoid CORS.
        if parsed.path.startswith("/api/cloud-pos/"):
            self._handle_cloud_proxy(parsed, method="GET")
            return

        # Proxy invoice PDF locally so the Tauri WebView can access it
        # (external admin URLs are blocked by CSP).
        # GET /api/invoices/<id>/pdf?template=official_classic
        if parsed.path.startswith("/api/invoices/") and parsed.path.endswith("/pdf"):
            parts = parsed.path.strip("/").split("/")
            # ["api", "invoices", "<id>", "pdf"]
            if len(parts) == 4:
                invoice_id = parts[2]
                qs = parse_qs(parsed.query)
                template = (qs.get("template") or [""])[0].strip() or None
                try:
                    pdf_bytes = _fetch_invoice_pdf(cfg, invoice_id, template=template)
                except Exception as ex:
                    json_response(self, {"error": "pdf_fetch_failed", "detail": str(ex)}, status=502)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/pdf")
                self.send_header("Content-Length", str(len(pdf_bytes)))
                self.send_header("Content-Disposition", f'inline; filename="invoice-{invoice_id}.pdf"')
                self.end_headers()
                self.wfile.write(pdf_bytes)
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

        # Cloud proxy: forward browser requests to cloud API to avoid CORS.
        if parsed.path.startswith("/api/cloud-pos/"):
            self._handle_cloud_proxy(parsed, method="POST")
            return

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
            rate_key = f"admin:{self.client_address[0]}"
            if _check_pin_rate_limit(rate_key):
                json_response(self, {"error": "too_many_attempts", "message": "Too many attempts. Try again later."}, status=429)
                return
            if not (cfg.get("admin_pin_hash") or "").strip():
                json_response(
                    self,
                    {"error": "admin_pin_not_set", "hint": "Set a PIN via POST /api/admin/pin/set (localhost only)."},
                    status=400,
                )
                return
            if not _verify_admin_pin(cfg, pin):
                _record_pin_failure(rate_key)
                json_response(self, {"error": "invalid_pin"}, status=401)
                return
            _reset_pin_attempts(rate_key)
            sess = _create_admin_session(int(cfg.get("admin_session_hours") or 12))
            json_response(self, {"ok": True, "token": sess["token"], "expires_at": sess["expires_at"]})
            return

        if parsed.path == "/api/auth/logout":
            session_token = self.headers.get("X-POS-Session") or ""
            if session_token:
                with db_connect() as conn:
                    cur = conn.cursor()
                    cur.execute("DELETE FROM pos_local_sessions WHERE token = ?", (session_token,))
                    conn.commit()
            json_response(self, {"ok": True})
            return

        setup_route = parsed.path.startswith("/api/setup/")
        if setup_route and not _is_loopback(client_ip):
            json_response(self, {"error": "forbidden", "hint": "Setup endpoints are available only from localhost."}, status=403)
            return

        # Guard mutating endpoints when the agent is LAN-exposed (or explicitly required).
        cfg = load_config()
        if (not setup_route) and _admin_pin_required(client_ip, cfg):
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
                auth_res, status, err = _setup_req_json_with_api_fallback(
                    api_base,
                    "auth/mfa/verify",
                    method="POST",
                    payload={"mfa_token": mfa_token, "code": mfa_code},
                )
            else:
                if not email or not password:
                    json_response(self, {"error": "email and password are required"}, status=400)
                    return
                auth_res, status, err = _setup_req_json_with_api_fallback(
                    api_base,
                    "auth/login",
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

            companies_res, c_status, c_err = _setup_req_json_with_api_fallback(
                api_base,
                "companies",
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
            res, status, err = _setup_req_json_with_api_fallback(
                api_base,
                "branches",
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
            _setup_req_json_with_api_fallback(
                api_base,
                "auth/select-company",
                method="POST",
                payload={"company_id": company_id},
                headers={"Authorization": f"Bearer {token}"},
            )

            res, status, err = _setup_req_json_with_api_fallback(
                api_base,
                "pos/devices",
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
            _perm_res, perm_status, perm_err = _setup_req_json_with_api_fallback(
                api_base,
                "pos/devices?limit=1",
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
            _setup_req_json_with_api_fallback(
                api_base,
                "auth/select-company",
                method="POST",
                payload={"company_id": company_id},
                headers={"Authorization": f"Bearer {token}"},
            )

            reg_res, status, err = _setup_req_json_with_api_fallback(
                api_base,
                f"pos/devices/register?{urlencode(params)}",
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
            # VAT must be derived from cloud /pos/config during sync pull.
            # Never allow manual overrides through local /api/config writes.
            data.pop("vat_rate", None)
            data.pop("vat_codes", None)
            for k in (
                "require_manager_approval_credit",
                "require_manager_approval_returns",
                "require_manager_approval_cross_company",
            ):
                if k in data:
                    data[k] = bool(data.get(k))
            if "outbox_stale_warn_minutes" in data:
                try:
                    data["outbox_stale_warn_minutes"] = max(1, min(1440, int(data.get("outbox_stale_warn_minutes") or 5)))
                except Exception:
                    data["outbox_stale_warn_minutes"] = int(cfg.get("outbox_stale_warn_minutes") or 5)
            if "receipt_template" in data:
                data["receipt_template"] = _normalize_receipt_template_id(data.get("receipt_template"))
            if "receipt_company_name" in data:
                data["receipt_company_name"] = _clean_receipt_text(data.get("receipt_company_name"), fallback="AH Trading", limit=64)
            if "receipt_footer_text" in data:
                data["receipt_footer_text"] = _clean_receipt_text(data.get("receipt_footer_text"), fallback="", limit=160)
            if "invoice_template" in data:
                data["invoice_template"] = _effective_invoice_template_id(data.get("invoice_template"), cfg.get("company_id"))
            for k, v in data.items():
                if k in _CONFIG_API_WRITABLE_KEYS:
                    cfg[k] = v
            save_config(cfg)
            json_response(self, {'ok': True, 'config': _public_config(cfg)})
            return

        if parsed.path == "/api/receipts/print-last":
            # Best-effort local printing (no browser dialog). Useful for kiosk setups.
            data = self.read_json()
            cfg = load_config()
            printer = (str(data.get("printer") or "").strip() or str(cfg.get("receipt_printer") or "").strip() or None)
            copies = data.get("copies") if "copies" in data else cfg.get("receipt_print_copies")
            profile = _receipt_render_profile(
                {
                    "receipt_template": data.get("template") if "template" in data else cfg.get("receipt_template"),
                    "receipt_company_name": data.get("company_name") if "company_name" in data else cfg.get("receipt_company_name"),
                    "receipt_footer_text": data.get("footer_text") if "footer_text" in data else cfg.get("receipt_footer_text"),
                    "company_id": cfg.get("company_id"),
                }
            )

            row = get_last_receipt()
            if not row:
                json_response(self, {"error": "no_receipt"}, status=404)
                return
            width_override = _effective_printer_width_chars(cfg, profile["template_id"])
            try:
                txt = _receipt_text(
                    row,
                    width=width_override,
                    template_id=profile["template_id"],
                    company_name=profile["company_name"],
                    footer_text=profile["footer_text"],
                    hide_company_name=bool(profile.get("hide_company_name")),
                    hide_vat_reference=bool(profile.get("hide_vat_reference")),
                )
                _print_text_to_printer(txt, printer=printer, copies=copies)
            except Exception as ex:
                json_response(self, {"error": "print_failed", "detail": str(ex), "printer": printer}, status=502)
                return

            json_response(
                self,
                {
                    "ok": True,
                    "printer": printer,
                    "copies": copies,
                    "template": profile["template_id"],
                },
            )
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

        if parsed.path == "/api/invoices/detail-by-event":
            data = self.read_json()
            cfg = load_config()
            event_id = str(data.get("event_id") or "").strip()
            if not event_id:
                json_response(self, {"error": "event_id is required"}, status=400)
                return
            try:
                resolved = _resolve_sales_invoice_from_event(cfg, event_id)
                base = _require_api_base(cfg)
                detail = fetch_json(
                    f"{base.rstrip('/')}/pos/sales-invoices/{quote(str(resolved['invoice_id']))}",
                    headers=device_headers(cfg),
                )
            except Exception as ex:
                json_response(self, {"error": "detail_failed", "detail": str(ex)}, status=502)
                return
            json_response(
                self,
                {
                    "ok": True,
                    "event_id": event_id,
                    **resolved,
                    "detail": detail,
                },
            )
            return

        if parsed.path == "/api/invoices/detail-by-id":
            data = self.read_json()
            cfg = load_config()
            invoice_id = str(data.get("invoice_id") or "").strip()
            if not invoice_id:
                json_response(self, {"error": "invoice_id is required"}, status=400)
                return
            try:
                base = _require_api_base(cfg)
                detail = fetch_json(
                    f"{base.rstrip('/')}/pos/sales-invoices/{quote(invoice_id)}",
                    headers=device_headers(cfg),
                )
            except Exception as ex:
                json_response(self, {"error": "detail_failed", "detail": str(ex)}, status=502)
                return
            json_response(
                self,
                {
                    "ok": True,
                    "invoice_id": invoice_id,
                    "detail": detail,
                },
            )
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
            invoice_template = _effective_invoice_template_id(
                data.get("template") if "template" in data else cfg.get("invoice_template"),
                cfg.get("company_id"),
            )

            # Step-by-step with structured error detail so UI can show what went wrong.
            step = "resolve"
            try:
                resolved = _resolve_sales_invoice_from_event(cfg, event_id)
            except Exception as ex:
                json_response(
                    self,
                    {"error": "print_failed", "step": step, "detail": str(ex), "event_id": event_id, "printer": printer},
                    status=502,
                )
                return

            # Resolve template from live invoice policy unless caller explicitly overrides it.
            if "template" not in data:
                try:
                    base = _require_api_base(cfg)
                    detail = fetch_json(
                        f"{base.rstrip('/')}/pos/sales-invoices/{quote(str(resolved['invoice_id']))}",
                        headers=device_headers(cfg),
                    )
                    if isinstance(detail, dict):
                        pp = detail.get("print_policy")
                        if isinstance(pp, dict) and "sales_invoice_pdf_template" in pp:
                            invoice_template = _effective_invoice_template_id(
                                pp.get("sales_invoice_pdf_template"),
                                cfg.get("company_id"),
                            )
                except Exception:
                    pass

            step = "fetch_pdf"
            try:
                pdf = _fetch_invoice_pdf(cfg, resolved["invoice_id"], template=invoice_template)
            except Exception as ex:
                json_response(
                    self,
                    {
                        "error": "print_failed", "step": step, "detail": str(ex),
                        "event_id": event_id, "invoice_id": resolved.get("invoice_id"),
                        "printer": printer,
                        "print_base_candidates": _print_base_candidates(cfg),
                    },
                    status=502,
                )
                return

            step = "spool"
            try:
                _print_pdf_to_printer(pdf, printer=printer, copies=copies)
            except Exception as ex:
                json_response(
                    self,
                    {
                        "error": "print_failed", "step": step, "detail": str(ex),
                        "event_id": event_id, "invoice_id": resolved.get("invoice_id"),
                        "printer": printer,
                    },
                    status=502,
                )
                return

            add_audit_log(
                "invoice.reprint",
                company_id=(cfg.get("company_id") or None),
                cashier_id=(str(data.get("cashier_id") or cfg.get("cashier_id") or "").strip() or None),
                shift_id=(str(data.get("shift_id") or cfg.get("shift_id") or "").strip() or None),
                event_id=event_id,
                status="ok",
                details={
                    "invoice_id": resolved.get("invoice_id"),
                    "invoice_no": resolved.get("invoice_no"),
                    "printer": printer,
                    "copies": copies,
                    "template": invoice_template,
                },
            )
            json_response(
                self,
                {
                    "ok": True,
                    "event_id": event_id,
                    "printer": printer,
                    "copies": copies,
                    "template": invoice_template,
                    **resolved,
                },
            )
            return

        if parsed.path == "/api/audit/log":
            data = self.read_json()
            cfg = load_config()
            action = str(data.get("action") or "").strip()
            if not action:
                json_response(self, {"error": "action is required"}, status=400)
                return
            add_audit_log(
                action,
                company_id=(cfg.get("company_id") or None),
                cashier_id=(str(data.get("cashier_id") or cfg.get("cashier_id") or "").strip() or None),
                shift_id=(str(data.get("shift_id") or cfg.get("shift_id") or "").strip() or None),
                event_id=(str(data.get("event_id") or "").strip() or None),
                status=(str(data.get("status") or "").strip() or None),
                details=data.get("details"),
            )
            json_response(self, {"ok": True})
            return

        if parsed.path == "/api/customers/create":
            data = self.read_json()
            name = str(data.get("name") or "").strip()
            phone = str(data.get("phone") or "").strip()
            email = str(data.get("email") or "").strip()
            party_type = str(data.get("party_type") or "individual").strip().lower()
            customer_type = str(data.get("customer_type") or "retail").strip().lower()
            legal_name = str(data.get("legal_name") or "").strip()
            membership_no = str(data.get("membership_no") or "").strip()
            tax_id = str(data.get("tax_id") or "").strip()
            vat_no = str(data.get("vat_no") or "").strip()
            notes = str(data.get("notes") or "").strip()
            terms_raw = str(data.get("payment_terms_days") if data.get("payment_terms_days") is not None else "").strip()
            try:
                payment_terms_days = int(terms_raw or "0")
            except Exception:
                payment_terms_days = 0
            if payment_terms_days < 0:
                payment_terms_days = 0
            if payment_terms_days > 3650:
                payment_terms_days = 3650
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
                "party_type": "business" if party_type == "business" else "individual",
                "customer_type": customer_type if customer_type in {"retail", "wholesale", "b2b"} else "retail",
                "marketing_opt_in": bool(data.get("marketing_opt_in")),
                "legal_name": legal_name or None,
                "membership_no": membership_no or None,
                "tax_id": tax_id or None,
                "vat_no": vat_no or None,
                "notes": notes or None,
                "is_member": bool(membership_no),
                "payment_terms_days": payment_terms_days,
                "is_active": bool(data.get("is_active", True)),
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
            idempotency_key = str(data.get("idempotency_key") or "").strip() or None
            if idempotency_key:
                existing = get_outbox_event_by_idempotency("sale.completed", idempotency_key)
                if existing and existing.get("event_id"):
                    was_acked = str(existing.get("status") or "") == "acked"
                    add_audit_log(
                        "sale.submit",
                        company_id=(cfg.get("company_id") or None),
                        cashier_id=(data.get("cashier_id") or cfg.get("cashier_id") or None),
                        shift_id=(data.get("shift_id") or cfg.get("shift_id") or None),
                        event_id=str(existing.get("event_id") or ""),
                        status="idempotent_replay",
                        details={"acked": was_acked, "payment_method": pm},
                    )
                    json_response(
                        self,
                        {
                            "event_id": str(existing.get("event_id")),
                            "sync_accepted": (was_acked if pm == "credit" else None),
                            "sync_deferred": ((not was_acked) if pm == "credit" else None),
                            "edge_accepted": (was_acked if pm == "credit" else None),
                            "idempotent_replay": True,
                        },
                    )
                    return
            shift_id = data.get('shift_id') or cfg.get('shift_id') or None
            cashier_id = data.get('cashier_id') or cfg.get('cashier_id') or None
            if not str(cashier_id or "").strip():
                json_response(self, {'error': 'Cashier sign-in required before sale.', 'code': 'cashier_required'}, status=400)
                return
            if not str(shift_id or "").strip():
                json_response(self, {'error': 'Open shift required before sale.', 'code': 'shift_required'}, status=400)
                return
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
            needs_manager = False
            if bool(cfg.get("require_manager_approval_credit")) and pm == "credit":
                needs_manager = True
            if bool(cfg.get("require_manager_approval_cross_company")):
                rm = payload.get("receipt_meta")
                pilot = rm.get("pilot") if isinstance(rm, dict) else {}
                if bool(pilot.get("cross_company")) or bool(pilot.get("flagged_for_adjustment")):
                    needs_manager = True
            if needs_manager and _require_manager_approval(self, cfg):
                add_audit_log(
                    "sale.submit",
                    company_id=(cfg.get("company_id") or None),
                    cashier_id=(cashier_id or None),
                    shift_id=(shift_id or None),
                    event_id=None,
                    status="manager_approval_required",
                    details={"payment_method": pm},
                )
                return
            created_at = datetime.now(timezone.utc).isoformat()
            event_id = str(uuid.uuid4())
            outbox_status = "pending"
            sync_accepted = None
            sync_deferred = None
            sync_error = None

            # For credit sales we try a fast online submission first, but do not hard-fail
            # the checkout on transient sync issues so offline mode can continue.
            if pm == "credit":
                ok, res = submit_single_event(
                    cfg,
                    event_id,
                    "sale.completed",
                    payload,
                    created_at,
                    idempotency_key=idempotency_key,
                )
                if ok:
                    outbox_status = "acked"
                    sync_accepted = True
                    sync_deferred = False
                else:
                    sync_accepted = False
                    sync_deferred = True
                    sync_error = res

            event_id, inserted = add_outbox_event_record(
                event_id,
                "sale.completed",
                payload,
                created_at,
                status=outbox_status,
                idempotency_key=idempotency_key,
            )
            if not inserted:
                existing = get_outbox_event_by_idempotency("sale.completed", idempotency_key) if idempotency_key else None
                was_acked = str((existing or {}).get("status") or "") == "acked"
                add_audit_log(
                    "sale.submit",
                    company_id=(cfg.get("company_id") or None),
                    cashier_id=(cashier_id or None),
                    shift_id=(shift_id or None),
                    event_id=str((existing or {}).get("event_id") or event_id),
                    status="idempotent_replay",
                    details={"acked": was_acked, "payment_method": pm},
                )
                json_response(
                    self,
                    {
                        "event_id": str((existing or {}).get("event_id") or event_id),
                        "sync_accepted": (was_acked if pm == "credit" else None),
                        "sync_deferred": ((not was_acked) if pm == "credit" else None),
                        "edge_accepted": (was_acked if pm == "credit" else None),
                        "idempotent_replay": True,
                    },
                )
                return

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
            if customer_id:
                cust = get_customer_by_id(str(customer_id))
                prev_usd = float((cust or {}).get("credit_balance_usd") or 0)
                prev_lbp = float((cust or {}).get("credit_balance_lbp") or 0)
                delta_usd = float(receipt.get("totals", {}).get("total_usd") or 0) if pm == "credit" else 0.0
                delta_lbp = float(receipt.get("totals", {}).get("total_lbp") or 0) if pm == "credit" else 0.0
                receipt["customer_name"] = (cust or {}).get("name") or None
                receipt["customer_balance"] = {
                    "previous_usd": prev_usd,
                    "previous_lbp": prev_lbp,
                    "sale_delta_usd": delta_usd,
                    "sale_delta_lbp": delta_lbp,
                    "after_usd": prev_usd + delta_usd,
                    "after_lbp": prev_lbp + delta_lbp,
                }
            save_receipt("sale", receipt)
            resp = {
                "event_id": event_id,
                "sync_accepted": (sync_accepted if pm == "credit" else None),
                "sync_deferred": (sync_deferred if pm == "credit" else None),
                "edge_accepted": (sync_accepted if pm == "credit" else None),
                "idempotent_replay": False,
            }
            if pm == "credit" and sync_error:
                resp["sync_error"] = sync_error
            add_audit_log(
                "sale.submit",
                company_id=(cfg.get("company_id") or None),
                cashier_id=(cashier_id or None),
                shift_id=(shift_id or None),
                event_id=event_id,
                status=("acked" if outbox_status == "acked" else "queued"),
                details={
                    "payment_method": pm,
                    "sync_accepted": resp.get("sync_accepted"),
                    "sync_deferred": resp.get("sync_deferred"),
                    "idempotent_replay": False,
                },
            )
            json_response(self, resp)
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
            idempotency_key = str(data.get("idempotency_key") or "").strip() or None
            if idempotency_key:
                existing = get_outbox_event_by_idempotency("sale.returned", idempotency_key)
                if existing and existing.get("event_id"):
                    was_acked = str(existing.get("status") or "") == "acked"
                    add_audit_log(
                        "return.submit",
                        company_id=(cfg.get("company_id") or None),
                        cashier_id=(data.get("cashier_id") or cfg.get("cashier_id") or None),
                        shift_id=(data.get("shift_id") or cfg.get("shift_id") or None),
                        event_id=str(existing.get("event_id") or ""),
                        status="idempotent_replay",
                        details={"acked": was_acked, "refund_method": str(refund_method or "")},
                    )
                    json_response(
                        self,
                        {
                            "event_id": str(existing.get("event_id")),
                            "sync_accepted": was_acked,
                            "sync_deferred": (not was_acked),
                            "edge_accepted": was_acked,
                            "idempotent_replay": True,
                        },
                    )
                    return
            shift_id = data.get('shift_id') or cfg.get('shift_id') or None
            cashier_id = data.get('cashier_id') or cfg.get('cashier_id') or None
            if not str(cashier_id or "").strip():
                json_response(self, {'error': 'Cashier sign-in required before return.', 'code': 'cashier_required'}, status=400)
                return
            if not str(shift_id or "").strip():
                json_response(self, {'error': 'Open shift required before return.', 'code': 'shift_required'}, status=400)
                return
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
            if bool(cfg.get("require_manager_approval_returns")) and _require_manager_approval(self, cfg):
                add_audit_log(
                    "return.submit",
                    company_id=(cfg.get("company_id") or None),
                    cashier_id=(cashier_id or None),
                    shift_id=(shift_id or None),
                    event_id=None,
                    status="manager_approval_required",
                    details={"refund_method": str(refund_method or "")},
                )
                return
            created_at = datetime.now(timezone.utc).isoformat()
            event_id = str(uuid.uuid4())
            outbox_status = "pending"
            sync_accepted = False
            sync_deferred = True
            sync_error = None

            # Best-effort fast path: if online and accepted, mark acked immediately.
            ok, res = submit_single_event(
                cfg,
                event_id,
                "sale.returned",
                payload,
                created_at,
                idempotency_key=idempotency_key,
            )
            if ok:
                outbox_status = "acked"
                sync_accepted = True
                sync_deferred = False
            else:
                sync_error = res
            event_id, inserted = add_outbox_event_record(
                event_id,
                "sale.returned",
                payload,
                created_at,
                status=outbox_status,
                idempotency_key=idempotency_key,
            )
            if not inserted:
                existing = get_outbox_event_by_idempotency("sale.returned", idempotency_key) if idempotency_key else None
                was_acked = str((existing or {}).get("status") or "") == "acked"
                add_audit_log(
                    "return.submit",
                    company_id=(cfg.get("company_id") or None),
                    cashier_id=(cashier_id or None),
                    shift_id=(shift_id or None),
                    event_id=str((existing or {}).get("event_id") or event_id),
                    status="idempotent_replay",
                    details={"acked": was_acked, "refund_method": str(refund_method or "")},
                )
                json_response(
                    self,
                    {
                        "event_id": str((existing or {}).get("event_id") or event_id),
                        "sync_accepted": was_acked,
                        "sync_deferred": (not was_acked),
                        "edge_accepted": was_acked,
                        "idempotent_replay": True,
                    },
                )
                return
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
            resp = {
                "event_id": event_id,
                "sync_accepted": sync_accepted,
                "sync_deferred": sync_deferred,
                "edge_accepted": sync_accepted,
                "idempotent_replay": False,
            }
            if sync_error:
                resp["sync_error"] = sync_error
            add_audit_log(
                "return.submit",
                company_id=(cfg.get("company_id") or None),
                cashier_id=(cashier_id or None),
                shift_id=(shift_id or None),
                event_id=event_id,
                status=("acked" if outbox_status == "acked" else "queued"),
                details={
                    "refund_method": str(refund_method or ""),
                    "sync_accepted": resp.get("sync_accepted"),
                    "sync_deferred": resp.get("sync_deferred"),
                    "idempotent_replay": False,
                },
            )
            json_response(self, resp)
            return

        if parsed.path == '/api/cashiers/login':
            data = self.read_json()
            pin = (data.get("pin") or "").strip()
            cfg = load_config()
            rate_key = f"cashier:{self.client_address[0]}"
            if _check_pin_rate_limit(rate_key):
                json_response(self, {"error": "too_many_attempts", "message": "Too many attempts. Try again later."}, status=429)
                return
            cashier = verify_cashier_pin(pin)
            online_error = ""
            if not cashier:
                # Fallback: if the local cache is empty/outdated, try verifying online.
                cashier, online_error = verify_cashier_pin_online(pin, cfg)
            if not cashier:
                _record_pin_failure(rate_key)
                if online_error == "invalid_device":
                    json_response(
                        self,
                        {
                            "error": "device credentials invalid",
                            "hint": "Reconnect this POS device from Settings (device token may be expired).",
                        },
                        status=401,
                    )
                    return
                if online_error == "not_assigned":
                    json_response(
                        self,
                        {
                            "error": "cashier not assigned to this device",
                            "hint": "Assign this cashier (or linked employee) to the POS device in Admin.",
                        },
                        status=403,
                    )
                    return
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
            _reset_pin_attempts(rate_key)
            cfg['cashier_id'] = cashier['id']
            save_config(cfg)
            json_response(self, {'ok': True, 'cashier': cashier, 'config': _public_config(cfg)})
            return

        if parsed.path == '/api/cashiers/logout':
            cfg = load_config()
            cfg['cashier_id'] = ''
            save_config(cfg)
            json_response(self, {'ok': True, 'config': _public_config(cfg)})
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

        if parsed.path == "/api/outbox/retry-one":
            data = self.read_json()
            event_id = str(data.get("event_id") or "").strip()
            if not event_id:
                json_response(self, {"error": "event_id is required"}, status=400)
                return

            cfg = load_config()
            try:
                base = _require_api_base(cfg)
            except Exception:
                json_response(self, {"error": "missing api_base_url"}, status=400)
                return
            company_id = (cfg.get("company_id") or "").strip()
            if not company_id:
                json_response(self, {"error": "missing company_id"}, status=400)
                return
            device_id = (cfg.get("device_id") or "").strip()
            if not device_id or not (cfg.get("device_token") or "").strip():
                json_response(self, {"error": "missing device_id or device_token"}, status=400)
                return

            ev = _get_outbox_event(event_id)
            if not ev:
                add_audit_log(
                    "outbox.retry",
                    company_id=company_id,
                    cashier_id=(cfg.get("cashier_id") or None),
                    shift_id=(cfg.get("shift_id") or None),
                    event_id=event_id,
                    status="missing",
                    details={"error": "event not found"},
                )
                json_response(self, {"error": "event not found", "event_id": event_id}, status=404)
                return
            if str(ev.get("status") or "").strip().lower() == "acked":
                add_audit_log(
                    "outbox.retry",
                    company_id=company_id,
                    cashier_id=(cfg.get("cashier_id") or None),
                    shift_id=(cfg.get("shift_id") or None),
                    event_id=event_id,
                    status="already_acked",
                    details=None,
                )
                json_response(self, {"ok": True, "event_id": event_id, "already_acked": True})
                return

            accepted, submit_res = submit_single_event(
                cfg,
                str(ev.get("event_id") or event_id),
                str(ev.get("event_type") or ""),
                ev.get("payload") or {},
                str(ev.get("created_at") or ""),
                ev.get("idempotency_key"),
            )
            if not accepted:
                rejected = None
                for row in (submit_res.get("rejected") or []):
                    if str((row or {}).get("event_id") or "").strip() == event_id:
                        rejected = row
                        break
                err = str((rejected or {}).get("error") or submit_res.get("error") or "outbox submit rejected")
                detail = str((rejected or {}).get("detail") or submit_res.get("detail") or "").strip()
                payload = {
                    "error": err,
                    "detail": detail or None,
                    "event_id": event_id,
                    "submit": submit_res,
                    "rejected": rejected,
                }
                add_audit_log(
                    "outbox.retry",
                    company_id=company_id,
                    cashier_id=(cfg.get("cashier_id") or None),
                    shift_id=(cfg.get("shift_id") or None),
                    event_id=event_id,
                    status="submit_rejected",
                    details=payload,
                )
                status = 409 if "missing" not in err.lower() else 400
                json_response(self, payload, status=status)
                return

            process_res, process_status, process_err = _setup_req_json_safe(
                f"{base.rstrip('/')}/pos/outbox/process-one",
                method="POST",
                payload={"event_id": event_id},
                headers=device_headers(cfg),
                timeout_s=12.0,
            )
            if process_status:
                add_audit_log(
                    "outbox.retry",
                    company_id=company_id,
                    cashier_id=(cfg.get("cashier_id") or None),
                    shift_id=(cfg.get("shift_id") or None),
                    event_id=event_id,
                    status="process_failed",
                    details={"status": process_status, "error": process_err or ""},
                )
                json_response(
                    self,
                    {
                        "error": "process_failed",
                        "detail": process_err or f"process failed ({process_status})",
                        "status": process_status,
                        "event_id": event_id,
                        "submit": submit_res,
                    },
                    status=502,
                )
                return

            if isinstance(process_res, dict) and str(process_res.get("error") or "").strip():
                add_audit_log(
                    "outbox.retry",
                    company_id=company_id,
                    cashier_id=(cfg.get("cashier_id") or None),
                    shift_id=(cfg.get("shift_id") or None),
                    event_id=event_id,
                    status="process_failed",
                    details={"error": str(process_res.get("error") or "").strip(), "process": process_res},
                )
                json_response(
                    self,
                    {
                        "error": "process_failed",
                        "detail": str(process_res.get("error")).strip(),
                        "event_id": event_id,
                        "submit": submit_res,
                        "process": process_res,
                    },
                    status=502,
                )
                return

            mark_outbox_sent([event_id])
            add_audit_log(
                "outbox.retry",
                company_id=company_id,
                cashier_id=(cfg.get("cashier_id") or None),
                shift_id=(cfg.get("shift_id") or None),
                event_id=event_id,
                status="acked",
                details={"submit": submit_res, "process": process_res},
            )
            json_response(self, {"ok": True, "event_id": event_id, "submit": submit_res, "process": process_res, "acked": True})
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
                if isinstance(pos_cfg.get("print_policy"), dict):
                    pp = pos_cfg.get("print_policy") or {}
                    if "sales_invoice_pdf_template" in pp:
                        cfg["invoice_template"] = _effective_invoice_template_id(
                            pp.get("sales_invoice_pdf_template"),
                            cfg.get("company_id"),
                        )
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
                json_response(
                    self,
                    {
                        'shift': shift,
                        'cash_methods': res.get('cash_methods') or [],
                        'has_cash_method_mapping': (res.get('has_cash_method_mapping') if 'has_cash_method_mapping' in res else None),
                    },
                )
            except URLError as ex:
                json_response(self, {'error': str(ex)}, status=502)
            return

        if parsed.path == '/api/shift/invoices':
            data = self.read_json()
            cfg = load_config()
            shift_id = str(data.get("shift_id") or cfg.get("shift_id") or "").strip()
            try:
                limit = int(data.get("limit") or 120)
            except Exception:
                limit = 120
            rows = list_shift_invoice_events(shift_id=shift_id, limit=limit)
            # Server fallback: if local data is empty, try fetching from backend.
            if not rows and shift_id:
                try:
                    base = _require_api_base(cfg)
                    hdrs = device_headers(cfg)
                    url = f"{base}/pos/shifts/{shift_id}/invoices?limit={limit}"
                    server_data = _fetch_json_timeout(url, headers=hdrs, timeout_s=5.0)
                    if isinstance(server_data, dict) and server_data.get("ok"):
                        rows = server_data.get("invoices") or []
                except Exception:
                    pass
            json_response(
                self,
                {
                    "ok": True,
                    "shift_id": (shift_id or None),
                    "invoices": rows,
                },
            )
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
                if not str(data.get("cashier_id") or "").strip():
                    json_response(self, {'error': 'Cashier sign-in required before opening shift.', 'code': 'cashier_required'}, status=400)
                    return
                res = post_json(f"{base}/pos/shifts/open", data, headers=device_headers(cfg))
                shift = res.get('shift')
                if shift:
                    cfg['shift_id'] = shift['id']
                    save_config(cfg)
                add_audit_log(
                    "shift.open",
                    company_id=(cfg.get("company_id") or None),
                    cashier_id=(str(data.get("cashier_id") or "").strip() or None),
                    shift_id=(shift.get("id") if isinstance(shift, dict) else None),
                    event_id=None,
                    status="acked",
                    details={
                        "opening_cash_usd": float(data.get("opening_cash_usd") or 0),
                        "opening_cash_lbp": float(data.get("opening_cash_lbp") or 0),
                    },
                )
                json_response(
                    self,
                    {
                        'shift': shift,
                        'cash_methods': res.get('cash_methods') or [],
                        'has_cash_method_mapping': (res.get('has_cash_method_mapping') if 'has_cash_method_mapping' in res else None),
                    },
                )
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
                if not str(data.get("cashier_id") or "").strip():
                    json_response(self, {'error': 'Cashier sign-in required before closing shift.', 'code': 'cashier_required'}, status=400)
                    return
                res = post_json(f"{base}/pos/shifts/{shift_id}/close", data, headers=device_headers(cfg))
                cfg['shift_id'] = ''
                save_config(cfg)
                add_audit_log(
                    "shift.close",
                    company_id=(cfg.get("company_id") or None),
                    cashier_id=(str(data.get("cashier_id") or "").strip() or None),
                    shift_id=(shift_id or None),
                    event_id=None,
                    status="acked",
                    details={
                        "closing_cash_usd": float(data.get("closing_cash_usd") or 0),
                        "closing_cash_lbp": float(data.get("closing_cash_lbp") or 0),
                    },
                )
                json_response(
                    self,
                    {
                        'shift': res.get('shift'),
                        'cash_methods': res.get('cash_methods') or [],
                        'has_cash_method_mapping': (res.get('has_cash_method_mapping') if 'has_cash_method_mapping' in res else None),
                    },
                )
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
                    SELECT event_id, event_type, payload_json, created_at, idempotency_key
                    FROM pos_outbox_events
                    WHERE status = 'pending'
                    ORDER BY created_at
                    LIMIT 500
                    """
                )
                rows = cur.fetchall()
                for r in rows:
                    events.append({
                        'event_id': r['event_id'],
                        'event_type': r['event_type'],
                        'payload': json.loads(r['payload_json']),
                        'created_at': r['created_at'],
                        'idempotency_key': (r['idempotency_key'] if r['idempotency_key'] else None),
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

        # ── Cart drafts (shared persistent storage) ──────────────────
        if parsed.path == "/api/drafts":
            data = self.read_json()
            cashier_id = (data.get("cashier_id") or "").strip()
            draft_id = (data.get("id") or "").strip()
            name = (data.get("name") or "").strip()
            draft_data = data.get("draft")
            if not draft_id or not isinstance(draft_data, dict):
                json_response(self, {"error": "id and draft (object) are required"}, status=400)
                return
            now_iso = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
            created_at = (data.get("created_at") or "").strip() or now_iso
            updated_at = (data.get("updated_at") or "").strip() or now_iso
            ok = upsert_cart_draft(draft_id, cashier_id, name, json.dumps(draft_data),
                                   created_at, updated_at)
            if ok:
                json_response(self, {"ok": True, "id": draft_id})
            else:
                json_response(self, {"error": "save failed"}, status=500)
            return

        if parsed.path == "/api/drafts/delete":
            data = self.read_json()
            draft_id = (data.get("id") or "").strip()
            if not draft_id:
                json_response(self, {"error": "id is required"}, status=400)
                return
            delete_cart_draft(draft_id)
            json_response(self, {"ok": True, "id": draft_id})
            return

        if parsed.path == "/api/drafts/delete-all":
            data = self.read_json()
            cashier_id = (data.get("cashier_id") or "").strip()
            if not cashier_id:
                json_response(self, {"error": "cashier_id is required"}, status=400)
                return
            count = delete_all_cart_drafts_for_cashier(cashier_id)
            json_response(self, {"ok": True, "deleted": count})
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
