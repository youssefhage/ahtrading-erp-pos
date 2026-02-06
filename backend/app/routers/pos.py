from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import uuid
from ..db import get_conn, set_company_context
from ..deps import require_device, get_company_id, require_company_access, require_permission
from ..security import hash_device_token
import secrets
import json
from decimal import Decimal

router = APIRouter(prefix="/pos", tags=["pos"])

class PosEvent(BaseModel):
    event_id: uuid.UUID
    event_type: str
    payload: dict
    created_at: datetime

class OutboxSubmit(BaseModel):
    company_id: Optional[uuid.UUID] = None
    device_id: uuid.UUID
    events: List[PosEvent]


class ShiftOpenIn(BaseModel):
    opening_cash_usd: Decimal = Decimal("0")
    opening_cash_lbp: Decimal = Decimal("0")
    notes: Optional[str] = None


class ShiftCloseIn(BaseModel):
    closing_cash_usd: Decimal = Decimal("0")
    closing_cash_lbp: Decimal = Decimal("0")
    notes: Optional[str] = None


@router.post("/devices/register")
def register_device(
    company_id: str,
    device_code: str,
    branch_id: Optional[str] = None,
    reset_token: bool = False,
    header_company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
    _perm=Depends(require_permission("pos:manage")),
):
    if company_id != header_company_id:
        raise HTTPException(status_code=400, detail="company_id mismatch")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, device_token_hash
                FROM pos_devices
                WHERE company_id = %s AND device_code = %s
                """,
                (company_id, device_code),
            )
            existing = cur.fetchone()
            if existing:
                if reset_token or not existing["device_token_hash"]:
                    token = secrets.token_urlsafe(32)
                    cur.execute(
                        """
                        UPDATE pos_devices
                        SET device_token_hash = %s
                        WHERE id = %s
                        """,
                        (hash_device_token(token), existing["id"]),
                    )
                    return {"id": existing["id"], "token": token}
                return {"id": existing["id"], "token": None}

            token = secrets.token_urlsafe(32)
            cur.execute(
                """
                INSERT INTO pos_devices (id, company_id, branch_id, device_code, device_token_hash)
                VALUES (gen_random_uuid(), %s, %s, %s, %s)
                RETURNING id
                """,
                (company_id, branch_id, device_code, hash_device_token(token)),
            )
            return {"id": cur.fetchone()["id"], "token": token}


@router.get("/devices", dependencies=[Depends(require_permission("pos:manage"))])
def list_devices(
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, branch_id, device_code, created_at,
                       (device_token_hash IS NOT NULL) AS has_token
                FROM pos_devices
                WHERE company_id = %s
                ORDER BY created_at DESC
                """,
                (company_id,),
            )
            return {"devices": cur.fetchall()}

@router.get("/outbox", dependencies=[Depends(require_permission("pos:manage"))])
def list_outbox_events(
    status: Optional[str] = None,
    device_id: Optional[uuid.UUID] = None,
    limit: int = 200,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
):
    if status and status not in {"pending", "processed", "failed", "dead"}:
        raise HTTPException(status_code=400, detail="invalid status")
    if limit <= 0 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 1000")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT o.id, o.device_id, d.device_code, o.event_type, o.created_at,
                       o.status, o.attempt_count, o.error_message, o.processed_at
                FROM pos_events_outbox o
                JOIN pos_devices d ON d.id = o.device_id
                WHERE d.company_id = %s
            """
            params = [company_id]
            if status:
                sql += " AND o.status = %s"
                params.append(status)
            if device_id:
                sql += " AND o.device_id = %s"
                params.append(device_id)
            sql += " ORDER BY o.created_at DESC LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            return {"events": cur.fetchall()}


@router.post("/outbox/{event_id}/requeue", dependencies=[Depends(require_permission("pos:manage"))])
def requeue_outbox_event(
    event_id: str,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE pos_events_outbox o
                SET status = 'pending',
                    attempt_count = 0,
                    error_message = NULL,
                    processed_at = NULL
                FROM pos_devices d
                WHERE o.id = %s
                  AND d.id = o.device_id
                  AND d.company_id = %s
                  AND o.status IN ('failed', 'dead')
                RETURNING o.id, o.status
                """,
                (event_id, company_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="event not found or not requeueable")
            return {"event": row}


@router.post("/devices/{device_id}/reset-token", dependencies=[Depends(require_permission("pos:manage"))])
def reset_device_token(
    device_id: str,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
):
    token = secrets.token_urlsafe(32)
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM pos_devices
                WHERE id = %s AND company_id = %s
                """,
                (device_id, company_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="device not found")
            cur.execute(
                """
                UPDATE pos_devices
                SET device_token_hash = %s
                WHERE id = %s
                """,
                (hash_device_token(token), device_id),
            )
    return {"id": device_id, "token": token}

@router.post("/outbox/submit")
def submit_outbox(data: OutboxSubmit, device=Depends(require_device)):
    if not data.events:
        return {"accepted": [], "rejected": []}
    if data.device_id != device["device_id"]:
        raise HTTPException(status_code=400, detail="device_id mismatch")
    if data.company_id and data.company_id != device["company_id"]:
        raise HTTPException(status_code=400, detail="company_id mismatch")

    accepted = []
    rejected = []

    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            for e in data.events:
                try:
                    cur.execute(
                        """
                        INSERT INTO pos_events_outbox (id, device_id, event_type, payload_json, created_at, status)
                        VALUES (%s, %s, %s, %s::jsonb, %s, 'pending')
                        ON CONFLICT (id) DO NOTHING
                        """,
                        (e.event_id, data.device_id, e.event_type, json.dumps(e.payload), e.created_at),
                    )
                    accepted.append(str(e.event_id))
                except Exception as ex:
                    rejected.append({"event_id": str(e.event_id), "error": str(ex)})
    return {"accepted": accepted, "rejected": rejected}

@router.get("/inbox/pull")
def pull_inbox(
    limit: int = 100,
    company_id: Optional[uuid.UUID] = None,
    device_id: Optional[uuid.UUID] = None,
    device=Depends(require_device),
):
    if device_id and device_id != device["device_id"]:
        raise HTTPException(status_code=400, detail="device_id mismatch")
    if company_id and company_id != device["company_id"]:
        raise HTTPException(status_code=400, detail="company_id mismatch")
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, event_type, payload_json
                FROM pos_events_inbox
                WHERE device_id = %s
                ORDER BY applied_at ASC
                LIMIT %s
                """,
                (device["device_id"], limit),
            )
            rows = cur.fetchall()
    return {"events": rows}


@router.get("/catalog")
def catalog(company_id: Optional[uuid.UUID] = None, device=Depends(require_device)):
    if company_id and company_id != device["company_id"]:
        raise HTTPException(status_code=400, detail="company_id mismatch")
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id, i.sku, i.barcode, i.name, i.unit_of_measure,
                       p.price_usd, p.price_lbp
                FROM items i
                LEFT JOIN LATERAL (
                    SELECT price_usd, price_lbp
                    FROM item_prices ip
                    WHERE ip.item_id = i.id
                      AND ip.effective_from <= CURRENT_DATE
                      AND (ip.effective_to IS NULL OR ip.effective_to >= CURRENT_DATE)
                    ORDER BY ip.effective_from DESC, ip.created_at DESC
                    LIMIT 1
                ) p ON true
                ORDER BY i.sku
                """
            )
            return {"items": cur.fetchall()}


@router.get("/catalog/delta")
def catalog_delta(
    since: datetime,
    limit: int = 5000,
    company_id: Optional[uuid.UUID] = None,
    device=Depends(require_device),
):
    """
    Incremental catalog sync for POS. Returns items whose `items.updated_at` changed
    since the cursor, or which have new prices inserted since the cursor.
    """
    if company_id and company_id != device["company_id"]:
        raise HTTPException(status_code=400, detail="company_id mismatch")
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id, i.sku, i.barcode, i.name, i.unit_of_measure,
                       p.price_usd, p.price_lbp,
                       GREATEST(i.updated_at, COALESCE(pm.last_price_created_at, i.updated_at)) AS changed_at
                FROM items i
                LEFT JOIN LATERAL (
                    SELECT price_usd, price_lbp
                    FROM item_prices ip
                    WHERE ip.item_id = i.id
                      AND ip.effective_from <= CURRENT_DATE
                      AND (ip.effective_to IS NULL OR ip.effective_to >= CURRENT_DATE)
                    ORDER BY ip.effective_from DESC, ip.created_at DESC
                    LIMIT 1
                ) p ON true
                LEFT JOIN LATERAL (
                    SELECT MAX(created_at) AS last_price_created_at
                    FROM item_prices ip
                    WHERE ip.item_id = i.id
                ) pm ON true
                WHERE i.updated_at > %s OR COALESCE(pm.last_price_created_at, 'epoch'::timestamptz) > %s
                ORDER BY i.sku
                LIMIT %s
                """,
                (since, since, limit),
            )
            rows = cur.fetchall()
    return {"items": rows, "next_cursor": datetime.utcnow().isoformat()}


@router.get("/config")
def pos_config(device=Depends(require_device)):
    """
    Device-scoped configuration for POS bootstrapping.
    """
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, branch_id, device_code
                FROM pos_devices
                WHERE id = %s
                """,
                (device["device_id"],),
            )
            dev = cur.fetchone()

            cur.execute(
                """
                SELECT id, base_currency, vat_currency, default_rate_type
                FROM companies
                WHERE id = %s
                """,
                (device["company_id"],),
            )
            company = cur.fetchone()

            cur.execute(
                """
                SELECT id, rate
                FROM tax_codes
                WHERE company_id = %s AND tax_type = 'vat'
                ORDER BY name
                LIMIT 1
                """,
                (device["company_id"],),
            )
            vat = cur.fetchone()

            cur.execute(
                """
                SELECT id
                FROM warehouses
                WHERE company_id = %s
                ORDER BY name
                LIMIT 1
                """,
                (device["company_id"],),
            )
            wh = cur.fetchone()

            cur.execute(
                """
                SELECT method, role_code
                FROM payment_method_mappings
                WHERE company_id = %s
                ORDER BY method
                """,
                (device["company_id"],),
            )
            pay_methods = cur.fetchall()

    return {
        "company_id": device["company_id"],
        "device": dev,
        "company": company,
        "default_warehouse_id": (wh["id"] if wh else None),
        "vat": vat,
        "payment_methods": pay_methods,
    }

@router.post("/heartbeat")
def heartbeat(
    status: str = "online",
    company_id: Optional[uuid.UUID] = None,
    device_id: Optional[uuid.UUID] = None,
    device=Depends(require_device),
):
    if status not in {"online", "offline", "shift_open", "shift_close"}:
        raise HTTPException(status_code=400, detail="invalid status")
    if device_id and device_id != device["device_id"]:
        raise HTTPException(status_code=400, detail="device_id mismatch")
    if company_id and company_id != device["company_id"]:
        raise HTTPException(status_code=400, detail="company_id mismatch")
    return {"ok": True, "status": status, "device_id": device["device_id"]}


@router.get("/exchange-rate")
def latest_exchange_rate(device=Depends(require_device)):
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT rate_date, rate_type, usd_to_lbp
                FROM exchange_rates
                WHERE company_id = %s
                ORDER BY rate_date DESC
                LIMIT 1
                """,
                (device["company_id"],),
            )
            row = cur.fetchone()
            return {"rate": row}


@router.get("/shifts/open")
def get_open_shift(device=Depends(require_device)):
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, status, opened_at, opening_cash_usd, opening_cash_lbp
                FROM pos_shifts
                WHERE company_id = %s AND device_id = %s AND status = 'open'
                ORDER BY opened_at DESC
                LIMIT 1
                """,
                (device["company_id"], device["device_id"]),
            )
            row = cur.fetchone()
            return {"shift": row}


@router.post("/shifts/open")
def open_shift(data: ShiftOpenIn, device=Depends(require_device)):
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM pos_shifts
                WHERE company_id = %s AND device_id = %s AND status = 'open'
                """,
                (device["company_id"], device["device_id"]),
            )
            if cur.fetchone():
                raise HTTPException(status_code=400, detail="shift already open")
            cur.execute(
                """
                INSERT INTO pos_shifts
                  (id, company_id, device_id, status, opened_at, opening_cash_usd, opening_cash_lbp, notes)
                VALUES
                  (gen_random_uuid(), %s, %s, 'open', now(), %s, %s, %s)
                RETURNING id, status, opened_at, opening_cash_usd, opening_cash_lbp
                """,
                (
                    device["company_id"],
                    device["device_id"],
                    data.opening_cash_usd,
                    data.opening_cash_lbp,
                    data.notes,
                ),
            )
            return {"shift": cur.fetchone()}


def _expected_cash(
    cur,
    company_id: str,
    device_id: str,
    shift_id: Optional[str],
    opened_at,
    opening_cash_usd: Decimal,
    opening_cash_lbp: Decimal,
):
    cur.execute(
        """
        SELECT method
        FROM payment_method_mappings
        WHERE company_id = %s AND role_code = 'CASH'
        """,
        (company_id,),
    )
    cash_methods = [r["method"] for r in cur.fetchall()] or []
    if not cash_methods:
        return Decimal("0"), Decimal("0")
    if shift_id:
        sql = """
            SELECT COALESCE(SUM(sp.amount_usd), 0) AS usd,
                   COALESCE(SUM(sp.amount_lbp), 0) AS lbp
            FROM sales_payments sp
            JOIN sales_invoices si ON si.id = sp.invoice_id
            WHERE si.company_id = %s AND si.shift_id = %s AND sp.method = ANY(%s)
        """
        params = [company_id, shift_id, cash_methods]
    else:
        sql = """
            SELECT COALESCE(SUM(sp.amount_usd), 0) AS usd,
                   COALESCE(SUM(sp.amount_lbp), 0) AS lbp
            FROM sales_payments sp
            JOIN sales_invoices si ON si.id = sp.invoice_id
            WHERE si.company_id = %s AND si.device_id = %s
              AND si.created_at >= %s
              AND sp.method = ANY(%s)
        """
        params = [company_id, device_id, opened_at, cash_methods]
    cur.execute(sql, params)
    row = cur.fetchone()

    sales_usd = Decimal(str(row["usd"] or 0))
    sales_lbp = Decimal(str(row["lbp"] or 0))

    movements_usd = Decimal("0")
    movements_lbp = Decimal("0")
    if shift_id:
        cur.execute(
            """
            SELECT
              COALESCE(SUM(CASE WHEN movement_type = 'cash_in' THEN amount_usd ELSE -amount_usd END), 0) AS usd,
              COALESCE(SUM(CASE WHEN movement_type = 'cash_in' THEN amount_lbp ELSE -amount_lbp END), 0) AS lbp
            FROM pos_cash_movements
            WHERE company_id = %s AND shift_id = %s
            """,
            (company_id, shift_id),
        )
        m = cur.fetchone()
        if m:
            movements_usd = Decimal(str(m["usd"] or 0))
            movements_lbp = Decimal(str(m["lbp"] or 0))

    expected_usd = Decimal(str(opening_cash_usd or 0)) + sales_usd + movements_usd
    expected_lbp = Decimal(str(opening_cash_lbp or 0)) + sales_lbp + movements_lbp
    return expected_usd, expected_lbp


@router.post("/shifts/{shift_id}/close")
def close_shift(shift_id: str, data: ShiftCloseIn, device=Depends(require_device)):
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, opened_at, opening_cash_usd, opening_cash_lbp
                FROM pos_shifts
                WHERE id = %s AND company_id = %s AND device_id = %s AND status = 'open'
                """,
                (shift_id, device["company_id"], device["device_id"]),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="open shift not found")
            expected_usd, expected_lbp = _expected_cash(
                cur,
                device["company_id"],
                device["device_id"],
                shift_id,
                row["opened_at"],
                row["opening_cash_usd"],
                row["opening_cash_lbp"],
            )
            variance_usd = Decimal(str(data.closing_cash_usd)) - expected_usd
            variance_lbp = Decimal(str(data.closing_cash_lbp)) - expected_lbp
            cur.execute(
                """
                UPDATE pos_shifts
                SET status = 'closed',
                    closed_at = now(),
                    closing_cash_usd = %s,
                    closing_cash_lbp = %s,
                    expected_cash_usd = %s,
                    expected_cash_lbp = %s,
                    variance_usd = %s,
                    variance_lbp = %s,
                    notes = COALESCE(%s, notes)
                WHERE id = %s
                RETURNING id, status, closed_at, expected_cash_usd, expected_cash_lbp, variance_usd, variance_lbp
                """,
                (
                    data.closing_cash_usd,
                    data.closing_cash_lbp,
                    expected_usd,
                    expected_lbp,
                    variance_usd,
                    variance_lbp,
                    data.notes,
                    shift_id,
                ),
            )
            return {"shift": cur.fetchone()}


class CashMovementIn(BaseModel):
    movement_type: str  # cash_in|cash_out|paid_out|safe_drop|other
    amount_usd: Decimal = Decimal("0")
    amount_lbp: Decimal = Decimal("0")
    notes: Optional[str] = None


@router.get("/cash-movements")
def list_cash_movements(
    shift_id: str,
    limit: int = 200,
    device=Depends(require_device),
):
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, movement_type, amount_usd, amount_lbp, notes, created_at
                FROM pos_cash_movements
                WHERE company_id = %s AND shift_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (device["company_id"], shift_id, limit),
            )
            return {"movements": cur.fetchall()}


@router.post("/cash-movements")
def create_cash_movement(data: CashMovementIn, device=Depends(require_device)):
    movement_type = (data.movement_type or "").strip().lower()
    if movement_type not in {"cash_in", "cash_out", "paid_out", "safe_drop", "other"}:
        raise HTTPException(status_code=400, detail="invalid movement_type")
    if data.amount_usd < 0 or data.amount_lbp < 0:
        raise HTTPException(status_code=400, detail="amounts must be >= 0")
    if data.amount_usd == 0 and data.amount_lbp == 0:
        raise HTTPException(status_code=400, detail="amount is required")

    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.transaction():
            with conn.cursor() as cur:
                # Must have an open shift for this device.
                cur.execute(
                    """
                    SELECT id
                    FROM pos_shifts
                    WHERE company_id = %s AND device_id = %s AND status = 'open'
                    ORDER BY opened_at DESC
                    LIMIT 1
                    """,
                    (device["company_id"], device["device_id"]),
                )
                shift = cur.fetchone()
                if not shift:
                    raise HTTPException(status_code=400, detail="no open shift")

                cur.execute(
                    """
                    INSERT INTO pos_cash_movements
                      (id, company_id, shift_id, device_id, movement_type, amount_usd, amount_lbp, notes)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        device["company_id"],
                        shift["id"],
                        device["device_id"],
                        movement_type,
                        data.amount_usd,
                        data.amount_lbp,
                        data.notes,
                    ),
                )
                return {"id": cur.fetchone()["id"], "shift_id": shift["id"]}


@router.get("/shifts", dependencies=[Depends(require_permission("pos:manage"))])
def list_shifts(company_id: str = Depends(get_company_id), _auth=Depends(require_company_access)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, device_id, status, opened_at, closed_at,
                       opening_cash_usd, opening_cash_lbp,
                       closing_cash_usd, closing_cash_lbp,
                       expected_cash_usd, expected_cash_lbp,
                       variance_usd, variance_lbp
                FROM pos_shifts
                WHERE company_id = %s
                ORDER BY opened_at DESC
                LIMIT 200
                """,
                (company_id,),
            )
            return {"shifts": cur.fetchall()}
