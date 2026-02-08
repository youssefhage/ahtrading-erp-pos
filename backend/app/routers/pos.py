from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional, Literal
from datetime import datetime
import uuid
from ..db import get_conn, set_company_context
from ..deps import require_device, get_company_id, require_company_access, require_permission
from ..security import hash_device_token, hash_pin, verify_pin
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
    cashier_id: Optional[str] = None


class ShiftCloseIn(BaseModel):
    closing_cash_usd: Decimal = Decimal("0")
    closing_cash_lbp: Decimal = Decimal("0")
    notes: Optional[str] = None
    cashier_id: Optional[str] = None


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


class InboxAckIn(BaseModel):
    event_ids: List[uuid.UUID]


@router.post("/inbox/ack")
def ack_inbox(data: InboxAckIn, device=Depends(require_device)):
    ids = [str(i) for i in (data.event_ids or [])]
    if not ids:
        return {"ok": True, "deleted": 0}
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM pos_events_inbox
                WHERE device_id = %s AND id = ANY(%s::uuid[])
                """,
                (device["device_id"], ids),
            )
            return {"ok": True, "deleted": cur.rowcount}


class InboxPushIn(BaseModel):
    device_id: uuid.UUID
    event_type: str
    payload: dict = {}


@router.post("/inbox/push", dependencies=[Depends(require_permission("pos:manage"))])
def push_inbox(
    data: InboxPushIn,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
):
    event_type = (data.event_type or "").strip()
    if not event_type:
        raise HTTPException(status_code=400, detail="event_type is required")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM pos_devices WHERE company_id=%s AND id=%s",
                (company_id, str(data.device_id)),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="device not found")
            cur.execute(
                """
                INSERT INTO pos_events_inbox (id, device_id, event_type, payload_json)
                VALUES (gen_random_uuid(), %s, %s, %s::jsonb)
                RETURNING id
                """,
                (str(data.device_id), event_type, json.dumps(data.payload or {})),
            )
            return {"id": cur.fetchone()["id"]}


@router.get("/catalog")
def catalog(company_id: Optional[uuid.UUID] = None, device=Depends(require_device)):
    if company_id and company_id != device["company_id"]:
        raise HTTPException(status_code=400, detail="company_id mismatch")
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT value_json->>'id' AS id
                FROM company_settings
                WHERE company_id = %s AND key = 'default_price_list_id'
                """,
                (device["company_id"],),
            )
            srow = cur.fetchone()
            default_pl_id = srow["id"] if srow else None
            cur.execute(
                """
                SELECT i.id, i.sku, i.barcode, i.name, i.unit_of_measure,
                       i.tax_code_id,
                       i.category_id, i.brand, i.short_name, i.description,
                       i.track_batches, i.track_expiry,
                       i.default_shelf_life_days, i.min_shelf_life_days_for_sale, i.expiry_warning_days,
                       i.updated_at,
                       COALESCE(plp.price_usd, p.price_usd) AS price_usd,
                       COALESCE(plp.price_lbp, p.price_lbp) AS price_lbp,
                       COALESCE(bc.barcodes, '[]'::jsonb) AS barcodes
                FROM items i
                LEFT JOIN LATERAL (
                    SELECT price_usd, price_lbp
                    FROM price_list_items pli
                    WHERE pli.company_id = i.company_id
                      AND pli.price_list_id = %s::uuid
                      AND pli.item_id = i.id
                      AND pli.effective_from <= CURRENT_DATE
                      AND (pli.effective_to IS NULL OR pli.effective_to >= CURRENT_DATE)
                    ORDER BY pli.effective_from DESC, pli.created_at DESC, pli.id DESC
                    LIMIT 1
                ) plp ON (%s::uuid IS NOT NULL)
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
                    SELECT jsonb_agg(
                        jsonb_build_object(
                          'id', b.id,
                          'barcode', b.barcode,
                          'qty_factor', b.qty_factor,
                          'label', b.label,
                          'is_primary', b.is_primary
                        )
                        ORDER BY b.is_primary DESC, b.created_at ASC
                    ) AS barcodes
                    FROM item_barcodes b
                    WHERE b.company_id = i.company_id AND b.item_id = i.id
                ) bc ON true
                WHERE i.is_active = true
                ORDER BY i.sku
                """
                ,
                (default_pl_id, default_pl_id),
            )
            return {"items": cur.fetchall(), "server_time": datetime.utcnow().isoformat()}


@router.get("/catalog/delta")
def catalog_delta(
    since: datetime,
    since_id: Optional[uuid.UUID] = None,
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
                SELECT value_json->>'id' AS id
                FROM company_settings
                WHERE company_id = %s AND key = 'default_price_list_id'
                """,
                (device["company_id"],),
            )
            srow = cur.fetchone()
            default_pl_id = srow["id"] if srow else None
            cur.execute(
                """
                WITH items_with_changed_at AS (
                  SELECT i.id, i.sku, i.barcode, i.name, i.unit_of_measure,
                         i.tax_code_id,
                         i.category_id, i.brand, i.short_name, i.description,
                         i.track_batches, i.track_expiry,
                         i.default_shelf_life_days, i.min_shelf_life_days_for_sale, i.expiry_warning_days,
                         COALESCE(plp.price_usd, p.price_usd) AS price_usd,
                         COALESCE(plp.price_lbp, p.price_lbp) AS price_lbp,
                         COALESCE(bc.barcodes, '[]'::jsonb) AS barcodes,
                         GREATEST(
                           i.updated_at,
                           COALESCE(pm.last_price_created_at, i.updated_at),
                           COALESCE(plm.last_pl_price_created_at, i.updated_at),
                           COALESCE(bm.last_barcode_updated_at, i.updated_at)
                         ) AS changed_at
                  FROM items i
                  LEFT JOIN LATERAL (
                      SELECT price_usd, price_lbp
                      FROM price_list_items pli
                      WHERE pli.company_id = i.company_id
                        AND pli.price_list_id = %s::uuid
                        AND pli.item_id = i.id
                        AND pli.effective_from <= CURRENT_DATE
                        AND (pli.effective_to IS NULL OR pli.effective_to >= CURRENT_DATE)
                      ORDER BY pli.effective_from DESC, pli.created_at DESC, pli.id DESC
                      LIMIT 1
                  ) plp ON (%s::uuid IS NOT NULL)
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
                  LEFT JOIN LATERAL (
                      SELECT MAX(created_at) AS last_pl_price_created_at
                      FROM price_list_items pli
                      WHERE pli.company_id = i.company_id
                        AND pli.price_list_id = %s::uuid
                        AND pli.item_id = i.id
                  ) plm ON true
                  LEFT JOIN LATERAL (
                      SELECT MAX(updated_at) AS last_barcode_updated_at
                      FROM item_barcodes b
                      WHERE b.company_id = i.company_id AND b.item_id = i.id
                  ) bm ON true
                  LEFT JOIN LATERAL (
                      SELECT jsonb_agg(
                          jsonb_build_object(
                            'id', b.id,
                            'barcode', b.barcode,
                            'qty_factor', b.qty_factor,
                            'label', b.label,
                            'is_primary', b.is_primary
                          )
                          ORDER BY b.is_primary DESC, b.created_at ASC
                      ) AS barcodes
                      FROM item_barcodes b
                      WHERE b.company_id = i.company_id AND b.item_id = i.id
                  ) bc ON true
                  WHERE i.is_active = true
                    AND (
                      i.updated_at > %s OR COALESCE(pm.last_price_created_at, 'epoch'::timestamptz) > %s
                     OR COALESCE(bm.last_barcode_updated_at, 'epoch'::timestamptz) > %s
                     OR COALESCE(plm.last_pl_price_created_at, 'epoch'::timestamptz) > %s
                    )
                )
                SELECT *
                FROM items_with_changed_at
                WHERE changed_at > %s
                   OR (%s::uuid IS NOT NULL AND changed_at = %s AND id > %s)
                ORDER BY changed_at ASC, id ASC
                LIMIT %s
                """,
                (
                    default_pl_id,
                    default_pl_id,
                    default_pl_id,
                    since,
                    since,
                    since,
                    since,
                    since,
                    since_id,
                    since,
                    since_id,
                    limit,
                ),
            )
            rows = cur.fetchall()
    if rows:
        last = rows[-1]
        next_cursor = last["changed_at"].isoformat()
        next_cursor_id = str(last["id"])
    else:
        next_cursor = since.isoformat()
        next_cursor_id = str(since_id) if since_id else None
    return {"items": rows, "next_cursor": next_cursor, "next_cursor_id": next_cursor_id}


@router.get("/item-categories/catalog")
def item_categories_catalog(device=Depends(require_device)):
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, parent_id, is_active, updated_at
                FROM item_categories
                WHERE company_id = %s AND is_active = true
                ORDER BY name
                """,
                (device["company_id"],),
            )
            return {"categories": cur.fetchall(), "server_time": datetime.utcnow().isoformat()}


@router.get("/item-categories/catalog/delta")
def item_categories_catalog_delta(
    since: datetime,
    since_id: Optional[uuid.UUID] = None,
    limit: int = 5000,
    device=Depends(require_device),
):
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, parent_id, is_active, updated_at AS changed_at
                FROM item_categories
                WHERE company_id = %s
                  AND (updated_at > %s OR (%s::uuid IS NOT NULL AND updated_at = %s AND id > %s))
                ORDER BY updated_at ASC, id ASC
                LIMIT %s
                """,
                (device["company_id"], since, since_id, since, since_id, limit),
            )
            rows = cur.fetchall()
    if rows:
        last = rows[-1]
        next_cursor = last["changed_at"].isoformat()
        next_cursor_id = str(last["id"])
    else:
        next_cursor = since.isoformat()
        next_cursor_id = str(since_id) if since_id else None
    return {"categories": rows, "next_cursor": next_cursor, "next_cursor_id": next_cursor_id}


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

            cur.execute(
                """
                SELECT value_json->>'id' AS id
                FROM company_settings
                WHERE company_id = %s AND key = 'default_price_list_id'
                """,
                (device["company_id"],),
            )
            srow = cur.fetchone()
            default_pl_id = srow["id"] if srow else None

    return {
        "company_id": device["company_id"],
        "device": dev,
        "company": company,
        "default_warehouse_id": (wh["id"] if wh else None),
        "vat": vat,
        "payment_methods": pay_methods,
        "default_price_list_id": default_pl_id,
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
                  (id, company_id, device_id, status, opened_at, opening_cash_usd, opening_cash_lbp, notes, opened_cashier_id)
                VALUES
                  (gen_random_uuid(), %s, %s, 'open', now(), %s, %s, %s, %s)
                RETURNING id, status, opened_at, opening_cash_usd, opening_cash_lbp
                """,
                (
                    device["company_id"],
                    device["device_id"],
                    data.opening_cash_usd,
                    data.opening_cash_lbp,
                    data.notes,
                    data.cashier_id,
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
                    closed_cashier_id = %s,
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
                    data.cashier_id,
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
    cashier_id: Optional[str] = None


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
                      (id, company_id, shift_id, device_id, movement_type, amount_usd, amount_lbp, notes, cashier_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s)
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
                        data.cashier_id,
                    ),
                )
                return {"id": cur.fetchone()["id"], "shift_id": shift["id"]}


class CashierIn(BaseModel):
    name: str
    pin: str
    is_active: bool = True


class CashierUpdate(BaseModel):
    name: Optional[str] = None
    pin: Optional[str] = None
    is_active: Optional[bool] = None


class CashierVerifyIn(BaseModel):
    pin: str


@router.get("/cashiers", dependencies=[Depends(require_permission("pos:manage"))])
def list_cashiers(company_id: str = Depends(get_company_id), _auth=Depends(require_company_access)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, is_active, updated_at
                FROM pos_cashiers
                WHERE company_id = %s
                ORDER BY name
                """,
                (company_id,),
            )
            return {"cashiers": cur.fetchall()}


@router.post("/cashiers", dependencies=[Depends(require_permission("pos:manage"))])
def create_cashier(data: CashierIn, company_id: str = Depends(get_company_id), _auth=Depends(require_company_access)):
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    pin = (data.pin or "").strip()
    if len(pin) < 4:
        raise HTTPException(status_code=400, detail="pin must be at least 4 digits")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pos_cashiers (id, company_id, name, pin_hash, is_active)
                VALUES (gen_random_uuid(), %s, %s, %s, %s)
                RETURNING id
                """,
                (company_id, data.name.strip(), hash_pin(pin), data.is_active),
            )
            return {"id": cur.fetchone()["id"]}


@router.patch("/cashiers/{cashier_id}", dependencies=[Depends(require_permission("pos:manage"))])
def update_cashier(cashier_id: str, data: CashierUpdate, company_id: str = Depends(get_company_id), _auth=Depends(require_company_access)):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}
    fields = []
    params = []
    if "name" in patch:
        fields.append("name = %s")
        params.append(patch["name"].strip())
    if "is_active" in patch:
        fields.append("is_active = %s")
        params.append(patch["is_active"])
    if "pin" in patch:
        pin = (patch["pin"] or "").strip()
        if len(pin) < 4:
            raise HTTPException(status_code=400, detail="pin must be at least 4 digits")
        fields.append("pin_hash = %s")
        params.append(hash_pin(pin))
    params.extend([company_id, cashier_id])

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE pos_cashiers
                SET {', '.join(fields)}, updated_at = now()
                WHERE company_id = %s AND id = %s
                RETURNING id
                """,
                params,
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="cashier not found")
            return {"ok": True}


@router.get("/cashiers/catalog")
def cashiers_catalog(device=Depends(require_device)):
    """
    Device sync endpoint. Includes PIN hashes so the POS can verify offline.
    """
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, pin_hash, is_active, updated_at
                FROM pos_cashiers
                WHERE company_id = %s AND is_active = true
                ORDER BY name
                """,
                (device["company_id"],),
            )
            return {"cashiers": cur.fetchall()}

@router.get("/customers/catalog")
def customers_catalog(device=Depends(require_device)):
    """
    POS customer master data snapshot (membership lookup + credit validation).
    """
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
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
                FROM customers
                WHERE company_id = %s
                ORDER BY name
                """,
                (device["company_id"],),
            )
            return {"customers": cur.fetchall(), "server_time": datetime.utcnow().isoformat()}


@router.get("/customers/catalog/delta")
def customers_catalog_delta(
    since: datetime,
    since_id: Optional[uuid.UUID] = None,
    limit: int = 5000,
    device=Depends(require_device),
):
    """
    Incremental customer sync for POS.
    """
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
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
                       updated_at AS changed_at
                FROM customers
                WHERE company_id = %s
                  AND (updated_at > %s OR (%s::uuid IS NOT NULL AND updated_at = %s AND id > %s))
                ORDER BY updated_at ASC, id ASC
                LIMIT %s
                """,
                (device["company_id"], since, since_id, since, since_id, limit),
            )
            rows = cur.fetchall()
    if rows:
        last = rows[-1]
        next_cursor = last["changed_at"].isoformat()
        next_cursor_id = str(last["id"])
    else:
        next_cursor = since.isoformat()
        next_cursor_id = str(since_id) if since_id else None
    return {"customers": rows, "next_cursor": next_cursor, "next_cursor_id": next_cursor_id}

@router.get("/promotions/catalog")
def promotions_catalog(device=Depends(require_device)):
    """
    POS promotions snapshot. Rules are evaluated locally by the POS (offline-first).
    """
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.id, p.code, p.name, p.starts_on, p.ends_on, p.is_active, p.priority, p.updated_at,
                       COALESCE(jsonb_agg(
                         jsonb_build_object(
                           'id', pi.id,
                           'item_id', pi.item_id,
                           'min_qty', pi.min_qty,
                           'promo_price_usd', pi.promo_price_usd,
                           'promo_price_lbp', pi.promo_price_lbp,
                           'discount_pct', pi.discount_pct,
                           'updated_at', pi.updated_at
                         )
                         ORDER BY pi.min_qty ASC
                       ) FILTER (WHERE pi.id IS NOT NULL), '[]'::jsonb) AS items
                FROM promotions p
                LEFT JOIN promotion_items pi
                  ON pi.company_id = p.company_id AND pi.promotion_id = p.id
                WHERE p.company_id = %s
                GROUP BY p.id
                ORDER BY p.priority DESC, p.code
                """,
                (device["company_id"],),
            )
            return {"promotions": cur.fetchall(), "server_time": datetime.utcnow().isoformat()}


@router.get("/promotions/delta")
def promotions_delta(
    since: datetime,
    since_id: Optional[uuid.UUID] = None,
    limit: int = 2000,
    device=Depends(require_device),
):
    """
    Incremental promotions sync for POS.
    """
    if limit <= 0 or limit > 5000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 5000")
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                WITH changed_promos AS (
                  SELECT p.id,
                         GREATEST(p.updated_at, COALESCE(MAX(pi.updated_at), p.updated_at)) AS changed_at
                  FROM promotions p
                  LEFT JOIN promotion_items pi
                    ON pi.company_id = p.company_id AND pi.promotion_id = p.id
                  WHERE p.company_id = %s
                  GROUP BY p.id
                  HAVING GREATEST(p.updated_at, COALESCE(MAX(pi.updated_at), p.updated_at)) > %s
                      OR (%s::uuid IS NOT NULL AND GREATEST(p.updated_at, COALESCE(MAX(pi.updated_at), p.updated_at)) = %s AND p.id > %s)
                  ORDER BY changed_at ASC, p.id ASC
                  LIMIT %s
                )
                SELECT p.id, p.code, p.name, p.starts_on, p.ends_on, p.is_active, p.priority, p.updated_at,
                       COALESCE(jsonb_agg(
                         jsonb_build_object(
                           'id', pi.id,
                           'item_id', pi.item_id,
                           'min_qty', pi.min_qty,
                           'promo_price_usd', pi.promo_price_usd,
                           'promo_price_lbp', pi.promo_price_lbp,
                           'discount_pct', pi.discount_pct,
                           'updated_at', pi.updated_at
                         )
                         ORDER BY pi.min_qty ASC
                       ) FILTER (WHERE pi.id IS NOT NULL), '[]'::jsonb) AS items,
                       cp.changed_at
                FROM changed_promos cp
                JOIN promotions p ON p.id = cp.id
                LEFT JOIN promotion_items pi
                  ON pi.company_id = p.company_id AND pi.promotion_id = p.id
                GROUP BY p.id, cp.changed_at
                ORDER BY cp.changed_at ASC, p.id ASC
                """,
                (device["company_id"], since, since_id, since, since_id, limit),
            )
            rows = cur.fetchall()
    if rows:
        last = rows[-1]
        next_cursor = last["changed_at"].isoformat()
        next_cursor_id = str(last["id"])
    else:
        next_cursor = since.isoformat()
        next_cursor_id = str(since_id) if since_id else None
    return {"promotions": rows, "next_cursor": next_cursor, "next_cursor_id": next_cursor_id}


@router.post("/cashiers/verify")
def verify_cashier(data: CashierVerifyIn, device=Depends(require_device)):
    pin = (data.pin or "").strip()
    if not pin:
        raise HTTPException(status_code=400, detail="pin is required")
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, pin_hash
                FROM pos_cashiers
                WHERE company_id = %s AND is_active = true
                ORDER BY updated_at DESC
                """,
                (device["company_id"],),
            )
            rows = cur.fetchall()
            for r in rows:
                if verify_pin(pin, r["pin_hash"]):
                    return {"cashier": {"id": r["id"], "name": r["name"]}}
    raise HTTPException(status_code=401, detail="invalid pin")

@router.get("/cash-movements/admin", dependencies=[Depends(require_permission("pos:manage"))])
def list_cash_movements_admin(
    shift_id: str,
    limit: int = 200,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
):
    if limit <= 0 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 1000")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT m.id, m.shift_id, m.device_id, d.device_code,
                       m.movement_type, m.amount_usd, m.amount_lbp,
                       m.notes, m.created_at
                FROM pos_cash_movements m
                JOIN pos_devices d ON d.id = m.device_id
                WHERE m.company_id = %s AND m.shift_id = %s
                ORDER BY m.created_at DESC
                LIMIT %s
                """,
                (company_id, shift_id, limit),
            )
            return {"movements": cur.fetchall()}


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
