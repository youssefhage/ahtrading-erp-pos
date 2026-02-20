from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime, date, timedelta
import uuid
from ..db import get_conn, set_company_context
from ..deps import require_device, get_company_id, require_company_access, require_permission, get_current_user
from ..security import hash_device_token, hash_pin, verify_pin
import secrets
import json
from decimal import Decimal
from psycopg.errors import ForeignKeyViolation, UniqueViolation  # type: ignore

router = APIRouter(prefix="/pos", tags=["pos"])
SALES_INVOICE_PDF_TEMPLATES = {"official_classic", "official_compact", "standard"}

class PosEvent(BaseModel):
    event_id: uuid.UUID
    event_type: str
    payload: dict
    created_at: datetime
    idempotency_key: Optional[str] = None

class OutboxSubmit(BaseModel):
    company_id: Optional[uuid.UUID] = None
    device_id: uuid.UUID
    events: List[PosEvent]


def _normalize_sales_invoice_pdf_template(value) -> Optional[str]:
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    return raw if raw in SALES_INVOICE_PDF_TEMPLATES else None


def _load_print_policy(cur, company_id: str) -> dict:
    cur.execute(
        """
        SELECT value_json
        FROM company_settings
        WHERE company_id = %s AND key = 'print_policy'
        LIMIT 1
        """,
        (company_id,),
    )
    row = cur.fetchone()
    if not row:
        return {"sales_invoice_pdf_template": None}

    raw = row.get("value_json")
    obj = {}
    if isinstance(raw, dict):
        obj = raw
    elif isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                obj = parsed
        except Exception:
            obj = {}

    tpl = _normalize_sales_invoice_pdf_template(obj.get("sales_invoice_pdf_template"))
    return {"sales_invoice_pdf_template": tpl}


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


def _assert_non_negative_shift_cash(usd_amount: Decimal, lbp_amount: Decimal, context: str) -> None:
    usd = Decimal(str(usd_amount or 0))
    lbp = Decimal(str(lbp_amount or 0))
    if usd < 0 or lbp < 0:
        raise HTTPException(status_code=400, detail=f"{context} cash must be >= 0")


def _load_cash_methods(cur, company_id: str) -> tuple[list[str], list[str]]:
    cur.execute(
        """
        SELECT method
        FROM payment_method_mappings
        WHERE company_id = %s AND role_code = 'CASH'
        ORDER BY method
        """,
        (company_id,),
    )
    methods = [str(r["method"]).strip() for r in (cur.fetchall() or []) if str(r.get("method") or "").strip()]
    normalized: list[str] = []
    seen: set[str] = set()
    for method in methods:
        key = method.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(key)
    return methods, normalized


class PosCustomerCreateIn(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    marketing_opt_in: bool = False
    legal_name: Optional[str] = None
    tax_id: Optional[str] = None
    vat_no: Optional[str] = None
    notes: Optional[str] = None
    membership_no: Optional[str] = None
    is_member: Optional[bool] = None
    membership_expires_at: Optional[date] = None
    party_type: Literal["individual", "business"] = "individual"
    customer_type: Literal["retail", "wholesale", "b2b"] = "retail"
    payment_terms_days: int = Field(default=0, ge=0, le=3650)
    is_active: bool = True


class PosDeviceUpdateIn(BaseModel):
    device_code: Optional[str] = None
    branch_id: Optional[str] = None


class PosDeviceCashierAssignmentsIn(BaseModel):
    cashier_ids: List[str] = Field(default_factory=list)


class PosDeviceEmployeeAssignmentsIn(BaseModel):
    user_ids: List[str] = Field(default_factory=list)


def _normalize_optional_uuid_text(value: Optional[str], field_name: str = "id") -> Optional[str]:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    try:
        return str(uuid.UUID(normalized))
    except Exception:
        raise HTTPException(status_code=422, detail=f"invalid {field_name}: {normalized}")


def _normalize_required_uuid_text(value: str, field_name: str) -> str:
    normalized = _normalize_optional_uuid_text(value, field_name)
    if not normalized:
        raise HTTPException(status_code=422, detail=f"{field_name} is required")
    return normalized


def _normalize_uuid_list(values: list[str], field_name: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in values or []:
        text = str(raw or "").strip()
        if not text:
            continue
        try:
            normalized = str(uuid.UUID(text))
        except Exception:
            raise HTTPException(status_code=422, detail=f"invalid {field_name}: {text}")
        if normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    return out


def _require_branch_in_company(cur, company_id: str, branch_id: Optional[str]) -> None:
    if not branch_id:
        return
    cur.execute(
        """
        SELECT id
        FROM branches
        WHERE company_id = %s AND id = %s
        """,
        (company_id, branch_id),
    )
    if not cur.fetchone():
        raise HTTPException(status_code=404, detail="branch not found")


def _has_pos_device_cashiers_table(cur) -> bool:
    cur.execute("SELECT to_regclass('public.pos_device_cashiers') IS NOT NULL AS ok")
    return bool((cur.fetchone() or {}).get("ok"))


def _has_pos_device_users_table(cur) -> bool:
    cur.execute("SELECT to_regclass('public.pos_device_users') IS NOT NULL AS ok")
    return bool((cur.fetchone() or {}).get("ok"))


def _has_pos_cashiers_user_id_column(cur) -> bool:
    cur.execute(
        """
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pos_cashiers'
            AND column_name = 'user_id'
        ) AS ok
        """
    )
    return bool((cur.fetchone() or {}).get("ok"))


def _has_pos_devices_health_columns(cur) -> bool:
    cur.execute(
        """
        SELECT COUNT(*)::int AS n
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'pos_devices'
          AND column_name IN ('last_seen_at', 'last_seen_status')
        """
    )
    return int((cur.fetchone() or {}).get("n") or 0) >= 2


def _require_device_exists(cur, company_id: str, device_id: str) -> None:
    cur.execute(
        """
        SELECT 1
        FROM pos_devices
        WHERE id = %s AND company_id = %s
        """,
        (device_id, company_id),
    )
    if not cur.fetchone():
        raise HTTPException(status_code=404, detail="device not found")


def _ensure_company_users_exist(cur, company_id: str, user_ids: list[str]) -> None:
    if not user_ids:
        return
    cur.execute(
        """
        SELECT DISTINCT ur.user_id AS id
        FROM user_roles ur
        WHERE ur.company_id = %s
          AND ur.user_id = ANY(%s::uuid[])
        """,
        (company_id, user_ids),
    )
    found = {str(r["id"]) for r in cur.fetchall()}
    missing = [uid for uid in user_ids if uid not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"user not found in company: {missing[0]}")


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
    next_device_code = (device_code or "").strip()
    if not next_device_code:
        raise HTTPException(status_code=400, detail="device_code is required")
    next_branch_id = _normalize_optional_uuid_text(branch_id, "branch_id")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            _require_branch_in_company(cur, company_id, next_branch_id)
            cur.execute(
                """
                SELECT id, device_token_hash
                FROM pos_devices
                WHERE company_id = %s AND device_code = %s
                """,
                (company_id, next_device_code),
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
                (company_id, next_branch_id, next_device_code, hash_device_token(token)),
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
            has_device_cashier_assignments = _has_pos_device_cashiers_table(cur)
            has_device_user_assignments = _has_pos_device_users_table(cur)
            has_health_columns = _has_pos_devices_health_columns(cur)
            health_select = (
                "d.last_seen_at, d.last_seen_status,"
                if has_health_columns
                else "NULL::timestamptz AS last_seen_at, NULL::text AS last_seen_status,"
            )
            user_assign_select = (
                "COALESCE(u_assign.assigned_employees_count, 0)::int AS assigned_employees_count,"
                if has_device_user_assignments
                else "0::int AS assigned_employees_count,"
            )
            user_assign_join = (
                """
                LEFT JOIN (
                  SELECT company_id, device_id, COUNT(*)::int AS assigned_employees_count
                  FROM pos_device_users
                  GROUP BY company_id, device_id
                ) u_assign
                  ON u_assign.company_id = d.company_id
                 AND u_assign.device_id = d.id
                """
                if has_device_user_assignments
                else ""
            )
            cashier_assign_select = (
                "COALESCE(c_assign.assigned_cashiers_count, 0)::int AS assigned_cashiers_count,"
                if has_device_cashier_assignments
                else "0::int AS assigned_cashiers_count,"
            )
            cashier_assign_join = (
                """
                LEFT JOIN (
                  SELECT company_id, device_id, COUNT(*)::int AS assigned_cashiers_count
                  FROM pos_device_cashiers
                  GROUP BY company_id, device_id
                ) c_assign
                  ON c_assign.company_id = d.company_id
                 AND c_assign.device_id = d.id
                """
                if has_device_cashier_assignments
                else ""
            )
            cur.execute(
                f"""
                SELECT d.id,
                       d.branch_id,
                       b.name AS branch_name,
                       d.device_code,
                       d.created_at,
                       d.updated_at,
                       {health_select}
                       (d.device_token_hash IS NOT NULL) AS has_token,
                       {cashier_assign_select}
                       {user_assign_select}
                       COALESCE(outbox.pending_events, 0)::int AS pending_events,
                       COALESCE(outbox.failed_events, 0)::int AS failed_events,
                       outbox.last_event_at,
                       COALESCE(shifts.open_shift_count, 0)::int AS open_shift_count
                FROM pos_devices d
                LEFT JOIN branches b
                  ON b.company_id = d.company_id
                 AND b.id = d.branch_id
                LEFT JOIN (
                  SELECT o.device_id,
                         COUNT(*) FILTER (WHERE o.status = 'pending')::int AS pending_events,
                         COUNT(*) FILTER (WHERE o.status IN ('failed', 'dead'))::int AS failed_events,
                         MAX(o.created_at) AS last_event_at
                  FROM pos_events_outbox o
                  GROUP BY o.device_id
                ) outbox
                  ON outbox.device_id = d.id
                LEFT JOIN (
                  SELECT s.device_id,
                         COUNT(*) FILTER (WHERE s.status = 'open')::int AS open_shift_count
                  FROM pos_shifts s
                  WHERE s.company_id = %s
                  GROUP BY s.device_id
                ) shifts
                  ON shifts.device_id = d.id
                {cashier_assign_join}
                {user_assign_join}
                WHERE d.company_id = %s
                ORDER BY d.created_at DESC
                """,
                (company_id, company_id),
            )
            return {"devices": cur.fetchall()}


@router.patch("/devices/{device_id}", dependencies=[Depends(require_permission("pos:manage"))])
def update_device(
    device_id: str,
    data: PosDeviceUpdateIn,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
    user=Depends(get_current_user),
):
    device_id = _normalize_required_uuid_text(device_id, "device_id")
    patch = data.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(status_code=400, detail="no fields to update")

    fields = []
    params: list[object] = []
    details: dict[str, object] = {}

    if "device_code" in patch:
        next_device_code = str(patch.get("device_code") or "").strip()
        if not next_device_code:
            raise HTTPException(status_code=400, detail="device_code is required")
        fields.append("device_code = %s")
        params.append(next_device_code)
        details["device_code"] = next_device_code

    next_branch_id = None
    if "branch_id" in patch:
        next_branch_id = _normalize_optional_uuid_text(patch.get("branch_id"), "branch_id")
        fields.append("branch_id = %s")
        params.append(next_branch_id)
        details["branch_id"] = next_branch_id

    if not fields:
        raise HTTPException(status_code=400, detail="no valid fields to update")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                if "branch_id" in patch:
                    _require_branch_in_company(cur, company_id, next_branch_id)
                try:
                    params.extend([device_id, company_id])
                    cur.execute(
                        f"""
                        UPDATE pos_devices
                        SET {", ".join(fields)}
                        WHERE id = %s AND company_id = %s
                        RETURNING id, branch_id, device_code, updated_at
                        """,
                        params,
                    )
                except UniqueViolation:
                    raise HTTPException(status_code=409, detail="device_code already exists")

                updated = cur.fetchone()
                if not updated:
                    raise HTTPException(status_code=404, detail="device not found")

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'pos.device.update', 'pos_device', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], device_id, json.dumps(details)),
                )
                return {"device": updated}


@router.get("/devices/{device_id}/cashiers", dependencies=[Depends(require_permission("pos:manage"))])
def list_device_cashier_assignments(
    device_id: str,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
):
    device_id = _normalize_required_uuid_text(device_id, "device_id")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            if not _has_pos_device_cashiers_table(cur):
                raise HTTPException(status_code=503, detail="device cashier assignments not available (run latest migrations)")
            cur.execute(
                """
                SELECT 1
                FROM pos_devices
                WHERE id = %s AND company_id = %s
                """,
                (device_id, company_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="device not found")

            cur.execute(
                """
                SELECT c.id,
                       c.name,
                       c.is_active,
                       c.updated_at,
                       (dc.cashier_id IS NOT NULL) AS assigned
                FROM pos_cashiers c
                LEFT JOIN pos_device_cashiers dc
                  ON dc.company_id = c.company_id
                 AND dc.device_id = %s
                 AND dc.cashier_id = c.id
                WHERE c.company_id = %s
                ORDER BY c.name
                """,
                (device_id, company_id),
            )
            return {"cashiers": cur.fetchall()}


@router.patch("/devices/{device_id}/cashiers", dependencies=[Depends(require_permission("pos:manage"))])
def replace_device_cashier_assignments(
    device_id: str,
    data: PosDeviceCashierAssignmentsIn,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
    user=Depends(get_current_user),
):
    device_id = _normalize_required_uuid_text(device_id, "device_id")
    cashier_ids = _normalize_uuid_list(data.cashier_ids or [], "cashier_id")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                if not _has_pos_device_cashiers_table(cur):
                    raise HTTPException(status_code=503, detail="device cashier assignments not available (run latest migrations)")
                cur.execute(
                    """
                    SELECT 1
                    FROM pos_devices
                    WHERE id = %s AND company_id = %s
                    """,
                    (device_id, company_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="device not found")

                if cashier_ids:
                    cur.execute(
                        """
                        SELECT id
                        FROM pos_cashiers
                        WHERE company_id = %s
                          AND id = ANY(%s::uuid[])
                        """,
                        (company_id, cashier_ids),
                    )
                    found = {str(r["id"]) for r in cur.fetchall()}
                    missing = [cid for cid in cashier_ids if cid not in found]
                    if missing:
                        raise HTTPException(status_code=404, detail=f"cashier not found: {missing[0]}")

                cur.execute(
                    """
                    DELETE FROM pos_device_cashiers
                    WHERE company_id = %s AND device_id = %s
                    """,
                    (company_id, device_id),
                )
                if cashier_ids:
                    cur.executemany(
                        """
                        INSERT INTO pos_device_cashiers (company_id, device_id, cashier_id)
                        VALUES (%s, %s, %s)
                        """,
                        [(company_id, device_id, cid) for cid in cashier_ids],
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'pos.device.cashiers.assign', 'pos_device', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        device_id,
                        json.dumps({"cashier_ids": cashier_ids, "assigned_count": len(cashier_ids)}),
                    ),
                )

                return {"ok": True, "assigned_count": len(cashier_ids)}


@router.get("/employees", dependencies=[Depends(require_permission("pos:manage"))])
def list_pos_employees(company_id: str = Depends(get_company_id), _auth=Depends(require_company_access)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT u.id,
                       u.email,
                       u.full_name,
                       u.phone,
                       COALESCE(u.is_active, true) AS is_active
                FROM users u
                JOIN user_roles ur
                  ON ur.user_id = u.id
                 AND ur.company_id = %s
                GROUP BY u.id, u.email, u.full_name, u.phone, u.is_active
                ORDER BY COALESCE(NULLIF(trim(u.full_name), ''), u.email)
                """,
                (company_id,),
            )
            return {"employees": cur.fetchall()}


@router.get("/devices/{device_id}/employees", dependencies=[Depends(require_permission("pos:manage"))])
def list_device_employee_assignments(
    device_id: str,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
):
    device_id = _normalize_required_uuid_text(device_id, "device_id")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            if not _has_pos_device_users_table(cur):
                raise HTTPException(status_code=503, detail="device employee assignments not available (run latest migrations)")
            _require_device_exists(cur, company_id, device_id)
            cur.execute(
                """
                SELECT u.id,
                       u.email,
                       u.full_name,
                       u.phone,
                       COALESCE(u.is_active, true) AS is_active,
                       COALESCE(bool_or(du.user_id IS NOT NULL), false) AS assigned
                FROM users u
                JOIN user_roles ur
                  ON ur.user_id = u.id
                 AND ur.company_id = %s
                LEFT JOIN pos_device_users du
                  ON du.company_id = ur.company_id
                 AND du.device_id = %s
                 AND du.user_id = u.id
                GROUP BY u.id, u.email, u.full_name, u.phone, u.is_active
                ORDER BY COALESCE(NULLIF(trim(u.full_name), ''), u.email)
                """,
                (company_id, device_id),
            )
            return {"employees": cur.fetchall()}


@router.patch("/devices/{device_id}/employees", dependencies=[Depends(require_permission("pos:manage"))])
def replace_device_employee_assignments(
    device_id: str,
    data: PosDeviceEmployeeAssignmentsIn,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
    user=Depends(get_current_user),
):
    device_id = _normalize_required_uuid_text(device_id, "device_id")
    user_ids = _normalize_uuid_list(data.user_ids or [], "user_id")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                if not _has_pos_device_users_table(cur):
                    raise HTTPException(status_code=503, detail="device employee assignments not available (run latest migrations)")
                _require_device_exists(cur, company_id, device_id)
                _ensure_company_users_exist(cur, company_id, user_ids)

                cur.execute(
                    """
                    DELETE FROM pos_device_users
                    WHERE company_id = %s AND device_id = %s
                    """,
                    (company_id, device_id),
                )
                if user_ids:
                    cur.executemany(
                        """
                        INSERT INTO pos_device_users (company_id, device_id, user_id)
                        VALUES (%s, %s, %s)
                        """,
                        [(company_id, device_id, uid) for uid in user_ids],
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'pos.device.employees.assign', 'pos_device', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        device_id,
                        json.dumps({"user_ids": user_ids, "assigned_count": len(user_ids)}),
                    ),
                )
                return {"ok": True, "assigned_count": len(user_ids)}

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


@router.get("/outbox/summary", dependencies=[Depends(require_permission("pos:manage"))])
def outbox_summary(
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT o.status, COUNT(*)::int AS count
                FROM pos_events_outbox o
                JOIN pos_devices d ON d.id = o.device_id
                WHERE d.company_id = %s
                GROUP BY o.status
                ORDER BY o.status
                """,
                (company_id,),
            )
            by_status = {r["status"]: int(r["count"] or 0) for r in cur.fetchall()}

            cur.execute(
                """
                SELECT o.status, MIN(o.created_at) AS oldest_created_at
                FROM pos_events_outbox o
                JOIN pos_devices d ON d.id = o.device_id
                WHERE d.company_id = %s
                GROUP BY o.status
                """,
                (company_id,),
            )
            oldest_by_status = {
                str(r["status"]): (r["oldest_created_at"].isoformat() if r["oldest_created_at"] is not None else None)
                for r in cur.fetchall()
            }

            cur.execute(
                """
                SELECT d.device_code, o.status, COUNT(*)::int AS count
                FROM pos_events_outbox o
                JOIN pos_devices d ON d.id = o.device_id
                WHERE d.company_id = %s
                GROUP BY d.device_code, o.status
                ORDER BY d.device_code, o.status
                """,
                (company_id,),
            )
            by_device: dict[str, dict[str, int]] = {}
            for r in cur.fetchall():
                device_code = str(r["device_code"] or "").strip() or "(unknown)"
                status = str(r["status"])
                by_device.setdefault(device_code, {})
                by_device[device_code][status] = int(r["count"] or 0)

            return {
                "total": sum(by_status.values()),
                "by_status": by_status,
                "by_device": by_device,
                "oldest_by_status": oldest_by_status,
            }


@router.get("/outbox/device")
def list_device_outbox(
    status: Optional[str] = None,
    limit: int = 200,
    device=Depends(require_device),
):
    if status and status not in {"pending", "processed", "failed", "dead"}:
        raise HTTPException(status_code=400, detail="invalid status")
    if limit <= 0 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 1000")

    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            sql = """
                SELECT id, device_id, event_type, created_at, status,
                       attempt_count, error_message, processed_at, next_attempt_at
                FROM pos_events_outbox
                WHERE device_id = %s
            """
            params = [device["device_id"]]
            if status:
                sql += " AND status = %s"
                params.append(status)
            sql += " ORDER BY created_at DESC LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            return {"outbox": cur.fetchall()}


@router.get("/outbox/device-summary")
def outbox_device_summary(device=Depends(require_device)):
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT status, COUNT(*)::int AS count, MIN(created_at) AS oldest_created_at
                FROM pos_events_outbox
                WHERE device_id = %s
                GROUP BY status
                ORDER BY status
                """,
                (device["device_id"],),
            )
            by_status: dict[str, int] = {}
            oldest_pending = None
            for row in cur.fetchall():
                st = str(row["status"])
                by_status[st] = int(row["count"] or 0)
                if st in {"pending", "failed"} and row.get("oldest_created_at") is not None:
                    ts = row["oldest_created_at"]
                    if oldest_pending is None or ts < oldest_pending:
                        oldest_pending = ts

            cur.execute(
                """
                SELECT MIN(next_attempt_at) AS next_retry_at
                FROM pos_events_outbox
                WHERE device_id = %s
                  AND status = 'failed'
                  AND next_attempt_at IS NOT NULL
                """,
                (device["device_id"],),
            )
            nrow = cur.fetchone() or {}
            next_retry_at = nrow.get("next_retry_at")

            oldest_pending_age_seconds = None
            if oldest_pending is not None:
                if oldest_pending.tzinfo is None:
                    now_ts = datetime.utcnow()
                else:
                    now_ts = datetime.now(oldest_pending.tzinfo)
                oldest_pending_age_seconds = max(0, int((now_ts - oldest_pending).total_seconds()))

            return {
                "device_id": device["device_id"],
                "total": sum(by_status.values()),
                "by_status": by_status,
                "oldest_pending_created_at": (oldest_pending.isoformat() if oldest_pending else None),
                "oldest_pending_age_seconds": oldest_pending_age_seconds,
                "next_retry_at": (next_retry_at.isoformat() if next_retry_at else None),
            }


@router.post("/outbox/{event_id}/requeue", dependencies=[Depends(require_permission("pos:manage"))])
def requeue_outbox_event(
    event_id: str,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
):
    event_id = _normalize_required_uuid_text(event_id, "event_id")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE pos_events_outbox o
                SET status = 'pending',
                    attempt_count = 0,
                    error_message = NULL,
                    processed_at = NULL,
                    next_attempt_at = now()
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
    device_id = _normalize_required_uuid_text(device_id, "device_id")
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


@router.post("/devices/{device_id}/deactivate", dependencies=[Depends(require_permission("pos:manage"))])
def deactivate_device(
    device_id: str,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
    user=Depends(get_current_user),
):
    device_id = _normalize_required_uuid_text(device_id, "device_id")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE pos_devices
                    SET device_token_hash = NULL
                    WHERE id = %s AND company_id = %s
                    RETURNING id
                    """,
                    (device_id, company_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="device not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'pos.device.deactivate', 'pos_device', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], device_id, json.dumps({})),
                )
                return {"ok": True}


@router.delete("/devices/{device_id}", dependencies=[Depends(require_permission("pos:manage"))])
def delete_device(
    device_id: str,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
    user=Depends(get_current_user),
):
    device_id = _normalize_required_uuid_text(device_id, "device_id")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, device_code
                    FROM pos_devices
                    WHERE id = %s AND company_id = %s
                    """,
                    (device_id, company_id),
                )
                device = cur.fetchone()
                if not device:
                    raise HTTPException(status_code=404, detail="device not found")

                ref_counts = []
                checks = [
                    ("sales_invoices", "device_id"),
                    ("sales_returns", "device_id"),
                    ("gl_journals", "created_by_device_id"),
                    ("stock_moves", "created_by_device_id"),
                    ("sales_refunds", "created_by_device_id"),
                ]
                for table_name, column_name in checks:
                    cur.execute(
                        f"SELECT COUNT(*)::int AS n FROM {table_name} WHERE company_id = %s AND {column_name} = %s",
                        (company_id, device_id),
                    )
                    count = int((cur.fetchone() or {}).get("n") or 0)
                    if count > 0:
                        ref_counts.append(f"{table_name}({count})")
                if ref_counts:
                    raise HTTPException(
                        status_code=409,
                        detail=f"device is referenced by: {', '.join(ref_counts)}",
                    )

                try:
                    cur.execute(
                        """
                        DELETE FROM pos_devices
                        WHERE id = %s AND company_id = %s
                        """,
                        (device_id, company_id),
                    )
                except ForeignKeyViolation:
                    raise HTTPException(status_code=409, detail="device has linked records and cannot be deleted")
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="device not found")

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'pos.device.delete', 'pos_device', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], device_id, json.dumps({"device_code": device["device_code"]})),
                )
                return {"ok": True}


@router.post("/outbox/submit")
def submit_outbox(data: OutboxSubmit, device=Depends(require_device)):
    if not data.events:
        return {"accepted": [], "accepted_meta": [], "rejected": []}
    if data.device_id != device["device_id"]:
        raise HTTPException(status_code=400, detail="device_id mismatch")
    if data.company_id and data.company_id != device["company_id"]:
        raise HTTPException(status_code=400, detail="company_id mismatch")

    accepted = []
    accepted_meta = []
    rejected = []

    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            for e in data.events:
                try:
                    idempotency_key = str(e.idempotency_key or "").strip() or None
                    cur.execute(
                        """
                        INSERT INTO pos_events_outbox
                          (id, device_id, event_type, payload_json, created_at, status, idempotency_key, next_attempt_at)
                        VALUES
                          (%s, %s, %s, %s::jsonb, %s, 'pending', %s, %s)
                        ON CONFLICT DO NOTHING
                        RETURNING id
                        """,
                        (
                            e.event_id,
                            data.device_id,
                            e.event_type,
                            json.dumps(e.payload),
                            e.created_at,
                            idempotency_key,
                            e.created_at,
                        ),
                    )
                    inserted = cur.fetchone()
                    status = "inserted" if inserted else "duplicate"
                    existing_event_id = None
                    if not inserted:
                        if idempotency_key:
                            cur.execute(
                                """
                                SELECT id
                                FROM pos_events_outbox
                                WHERE device_id = %s
                                  AND event_type = %s
                                  AND idempotency_key = %s
                                ORDER BY created_at ASC
                                LIMIT 1
                                """,
                                (data.device_id, e.event_type, idempotency_key),
                            )
                        else:
                            cur.execute(
                                """
                                SELECT id
                                FROM pos_events_outbox
                                WHERE id = %s
                                """,
                                (e.event_id,),
                            )
                        existing = cur.fetchone()
                        if existing:
                            existing_event_id = str(existing["id"])
                    accepted.append(str(e.event_id))
                    meta = {"event_id": str(e.event_id), "status": status}
                    if existing_event_id and existing_event_id != str(e.event_id):
                        meta["existing_event_id"] = existing_event_id
                    accepted_meta.append(meta)
                except Exception as ex:
                    rejected.append({"event_id": str(e.event_id), "error": str(ex)})
    return {"accepted": accepted, "accepted_meta": accepted_meta, "rejected": rejected}


class OutboxProcessOneIn(BaseModel):
    event_id: uuid.UUID
    force: bool = False


@router.post("/outbox/process-one")
def process_outbox_event_now(data: OutboxProcessOneIn, device=Depends(require_device)):
    """
    Process a specific POS outbox event immediately (synchronous best-effort).

    This is used by kiosk/POS printing flows that need an invoice id right away
    (e.g. print the A4 invoice PDF on the register) instead of waiting for the
    background worker to pick up the outbox row.
    """
    # Import lazily to keep router import time small.
    from ...workers import pos_processor as pp  # type: ignore

    company_id = str(device["company_id"])
    device_id = str(device["device_id"])
    event_id = str(data.event_id)
    error_detail: Optional[str] = None
    response_payload: Optional[dict] = None

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, device_id, event_type, payload_json, status, attempt_count, next_attempt_at
                    FROM pos_events_outbox
                    WHERE id = %s AND device_id = %s
                    FOR UPDATE
                    """,
                    (event_id, device_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="event not found")

                event_type = str(row["event_type"] or "")
                status = str(row["status"] or "")
                attempt_count = int(row.get("attempt_count") or 0)
                next_attempt_at = row.get("next_attempt_at")

                if status == "dead" and not data.force:
                    raise HTTPException(status_code=409, detail="event is dead; requeue it before retrying")
                if status == "failed" and (next_attempt_at is not None) and not data.force:
                    if next_attempt_at.tzinfo is None:
                        now_ts = datetime.utcnow()
                    else:
                        now_ts = datetime.now(next_attempt_at.tzinfo)
                    if next_attempt_at > now_ts:
                        raise HTTPException(status_code=409, detail=f"retry scheduled at {next_attempt_at.isoformat()}")

                # If it's already processed, just return the linked document (if any).
                if status == "processed":
                    inv = None
                    ret = None
                    if event_type == "sale.completed":
                        cur.execute(
                            """
                            SELECT id, invoice_no
                            FROM sales_invoices
                            WHERE company_id = %s AND source_event_id = %s
                            """,
                            (company_id, event_id),
                        )
                        inv = cur.fetchone()
                    elif event_type == "sale.returned":
                        cur.execute(
                            """
                            SELECT id, return_no
                            FROM sales_returns
                            WHERE company_id = %s AND source_event_id = %s
                            """,
                            (company_id, event_id),
                        )
                        ret = cur.fetchone()
                    response_payload = {
                        "ok": True,
                        "event_id": event_id,
                        "event_type": event_type,
                        "status": "processed",
                        "invoice_id": (str(inv["id"]) if inv else None),
                        "invoice_no": (inv.get("invoice_no") if inv else None),
                        "return_id": (str(ret["id"]) if ret else None),
                        "return_no": (ret.get("return_no") if ret else None),
                    }
                else:
                    payload = row.get("payload_json") or {}
                    if isinstance(payload, str):
                        try:
                            payload = json.loads(payload)
                        except Exception:
                            payload = {}

                    process_error = None
                    try:
                        # Isolate document posting in a savepoint so DB errors don't poison
                        # the outer transaction; this lets us persist failed/dead status.
                        with conn.transaction():
                            if event_type == "sale.completed":
                                pp.process_sale(cur, company_id, event_id, payload, device_id)
                            elif event_type == "sale.returned":
                                pp.process_sale_return(cur, company_id, event_id, payload, device_id)
                            elif event_type == "pos.cash_movement":
                                pp.process_cash_movement(cur, company_id, event_id, payload, device_id)
                            elif event_type == "purchase.received":
                                pp.process_goods_receipt(cur, company_id, event_id, payload, device_id)
                            elif event_type == "purchase.invoice":
                                pp.process_purchase_invoice(cur, company_id, event_id, payload, device_id)
                            else:
                                raise ValueError(f"unsupported event type {event_type}")

                            cur.execute(
                                """
                                UPDATE pos_events_outbox
                                SET status = 'processed',
                                    processed_at = now(),
                                    error_message = NULL,
                                    next_attempt_at = NULL
                                WHERE id = %s
                                """,
                                (event_id,),
                            )
                    except Exception as ex:
                        process_error = ex

                    if process_error is not None:
                        # Keep the same attempt/dead semantics as the worker.
                        next_attempt = attempt_count + 1
                        max_attempts = 5
                        next_status = "dead" if next_attempt >= max_attempts else "failed"
                        next_retry_at = pp.next_retry_at_for_attempt(next_attempt, event_id)
                        cur.execute(
                            """
                            UPDATE pos_events_outbox
                            SET status = %s,
                                attempt_count = %s,
                                error_message = %s,
                                next_attempt_at = %s
                            WHERE id = %s
                            """,
                            (
                                next_status,
                                next_attempt,
                                str(process_error),
                                (next_retry_at if next_status == "failed" else None),
                                event_id,
                            ),
                        )
                        error_detail = str(process_error)
                        response_payload = {"ok": False, "event_id": event_id, "event_type": event_type, "status": next_status}
                    else:
                        inv = None
                        ret = None
                        if event_type == "sale.completed":
                            cur.execute(
                                """
                                SELECT id, invoice_no
                                FROM sales_invoices
                                WHERE company_id = %s AND source_event_id = %s
                                """,
                                (company_id, event_id),
                            )
                            inv = cur.fetchone()
                        elif event_type == "sale.returned":
                            cur.execute(
                                """
                                SELECT id, return_no
                                FROM sales_returns
                                WHERE company_id = %s AND source_event_id = %s
                                """,
                                (company_id, event_id),
                            )
                            ret = cur.fetchone()

                        response_payload = {
                            "ok": True,
                            "event_id": event_id,
                            "event_type": event_type,
                            "status": "processed",
                            "invoice_id": (str(inv["id"]) if inv else None),
                            "invoice_no": (inv.get("invoice_no") if inv else None),
                            "return_id": (str(ret["id"]) if ret else None),
                            "return_no": (ret.get("return_no") if ret else None),
                        }

    if error_detail:
        raise HTTPException(status_code=409, detail=error_detail)
    if response_payload is not None:
        return response_payload
    raise HTTPException(status_code=500, detail="unexpected empty process result")

@router.get("/inbox/pull")
def pull_inbox(
    limit: int = 100,
    company_id: Optional[uuid.UUID] = None,
    device_id: Optional[uuid.UUID] = None,
    device=Depends(require_device),
):
    if limit <= 0 or limit > 2000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 2000")
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
                          'qty_factor', COALESCE(c.to_base_factor, b.qty_factor),
                          'uom_code', b.uom_code,
                          'label', b.label,
                          'is_primary', b.is_primary
                        )
                        ORDER BY b.is_primary DESC, b.created_at ASC
                    ) AS barcodes
                    FROM item_barcodes b
                    LEFT JOIN item_uom_conversions c
                      ON c.company_id = b.company_id
                     AND c.item_id = b.item_id
                     AND c.uom_code = b.uom_code
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
    if limit <= 0 or limit > 10000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 10000")
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
                            'qty_factor', COALESCE(c.to_base_factor, b.qty_factor),
                            'uom_code', b.uom_code,
                            'label', b.label,
                            'is_primary', b.is_primary
                          )
                          ORDER BY b.is_primary DESC, b.created_at ASC
                      ) AS barcodes
                      FROM item_barcodes b
                      LEFT JOIN item_uom_conversions c
                        ON c.company_id = b.company_id
                       AND c.item_id = b.item_id
                       AND c.uom_code = b.uom_code
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
    if limit <= 0 or limit > 10000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 10000")
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


@router.get("/items/{item_id}/batches")
def list_item_batches(
    item_id: str,
    warehouse_id: uuid.UUID,
    limit: int = 200,
    device=Depends(require_device),
):
    """
    POS helper for manual lot/batch selection:
    returns eligible batches with on-hand quantities, sorted by FEFO (earliest expiry first).
    """
    if limit <= 0 or limit > 2000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 2000")
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT track_batches, track_expiry,
                       COALESCE(min_shelf_life_days_for_sale, 0)::int AS item_min_days
                FROM items
                WHERE company_id=%s AND id=%s
                """,
                (device["company_id"], item_id),
            )
            it = cur.fetchone()
            if not it:
                raise HTTPException(status_code=404, detail="item not found")

            cur.execute(
                """
                SELECT COALESCE(min_shelf_life_days_for_sale_default, 0)::int AS wh_min_days
                FROM warehouses
                WHERE company_id=%s AND id=%s
                """,
                (device["company_id"], str(warehouse_id)),
            )
            wrow = cur.fetchone()
            if not wrow:
                raise HTTPException(status_code=404, detail="warehouse not found")

            min_days = max(int(it.get("item_min_days") or 0), int(wrow.get("wh_min_days") or 0))
            today = date.today()
            min_expiry_date = (today + timedelta(days=min_days)) if min_days > 0 else None
            require_expiry = bool(it.get("track_expiry")) or min_days > 0

            cur.execute(
                """
                SELECT sm.batch_id,
                       b.batch_no, b.expiry_date, b.status,
                       COALESCE(SUM(sm.qty_in - sm.qty_out), 0) AS on_hand
                FROM stock_moves sm
                LEFT JOIN batches b
                  ON b.id = sm.batch_id
                WHERE sm.company_id=%s
                  AND sm.item_id=%s
                  AND sm.warehouse_id=%s
                  AND sm.batch_id IS NOT NULL
                  AND (b.status = 'available')
                  AND (b.expiry_date IS NULL OR b.expiry_date >= %s)
                  AND (%s = false OR b.expiry_date IS NOT NULL)
                  AND (%s::date IS NULL OR b.expiry_date >= %s)
                GROUP BY sm.batch_id, b.batch_no, b.expiry_date, b.status
                HAVING COALESCE(SUM(sm.qty_in - sm.qty_out), 0) > 0
                ORDER BY b.expiry_date NULLS LAST, sm.batch_id
                LIMIT %s
                """,
                (
                    device["company_id"],
                    item_id,
                    str(warehouse_id),
                    today,
                    require_expiry,
                    min_expiry_date,
                    min_expiry_date,
                    limit,
                ),
            )
            rows = cur.fetchall()

            # Add a small derived field (days_to_expiry) for POS UX.
            out = []
            for r in rows:
                exp = r.get("expiry_date")
                dte = None
                if exp:
                    try:
                        dte = (exp - today).days
                    except Exception:
                        dte = None
                out.append({**r, "days_to_expiry": dte, "min_shelf_life_days": min_days})
            return {"batches": out, "server_time": datetime.utcnow().isoformat()}


@router.get("/config")
def pos_config(device=Depends(require_device)):
    """
    Device-scoped configuration for POS bootstrapping.
    """
    inventory_policy = {"require_manual_lot_selection": False}
    print_policy = {"sales_invoice_pdf_template": None}
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
                SELECT id, name, legal_name, registration_no, vat_no,
                       base_currency, vat_currency, default_rate_type
                FROM companies
                WHERE id = %s
                """,
                (device["company_id"],),
            )
            company = cur.fetchone()

            # VAT codes: return the full set so POS can do item-level VAT (exempt/zero-rated/standard).
            cur.execute(
                """
                SELECT id, rate, name
                FROM tax_codes
                WHERE company_id = %s AND tax_type = 'vat'
                ORDER BY name
                """,
                (device["company_id"],),
            )
            vat_codes = cur.fetchall() or []
            cur.execute(
                """
                SELECT value_json
                FROM company_settings
                WHERE company_id = %s
                  AND key = 'default_vat_tax_code_id'
                LIMIT 1
                """,
                (device["company_id"],),
            )
            vrow = cur.fetchone()
            configured_default_vat_tax_code_id = None
            if vrow and vrow.get("value_json") is not None:
                raw = vrow.get("value_json")
                if isinstance(raw, dict):
                    configured_default_vat_tax_code_id = str(raw.get("id") or raw.get("tax_code_id") or "").strip() or None
                else:
                    configured_default_vat_tax_code_id = str(raw or "").strip() or None

            vat = None
            if configured_default_vat_tax_code_id:
                for row in vat_codes:
                    if str(row.get("id")) == configured_default_vat_tax_code_id:
                        vat = row
                        break
            # Compliance guardrail: only auto-pick when there is exactly one VAT code.
            # With multiple VAT codes, require explicit company setting to avoid silent misclassification.
            if not vat and len(vat_codes) == 1:
                vat = vat_codes[0]
            default_vat_tax_code_id = str(vat["id"]) if vat else None

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

            # Inventory policy used by POS UI for batch/expiry prompting behavior.
            cur.execute(
                """
                SELECT value_json
                FROM company_settings
                WHERE company_id = %s AND key = 'inventory'
                """,
                (device["company_id"],),
            )
            prow = cur.fetchone()
            if prow and prow.get("value_json"):
                try:
                    inv = prow["value_json"] or {}
                    inventory_policy["require_manual_lot_selection"] = bool(inv.get("require_manual_lot_selection"))
                except Exception:
                    inventory_policy = {"require_manual_lot_selection": False}

            print_policy = _load_print_policy(cur, str(device["company_id"]))

    return {
        "company_id": device["company_id"],
        "device": dev,
        "company": company,
        "default_warehouse_id": (wh["id"] if wh else None),
        "vat": vat,
        "default_vat_tax_code_id": default_vat_tax_code_id,
        "vat_codes": vat_codes,
        "payment_methods": pay_methods,
        "default_price_list_id": default_pl_id,
        "inventory_policy": inventory_policy,
        "print_policy": print_policy,
    }


def _fetch_pos_sales_invoice_detail(cur, company_id: str, invoice_id: str, device_id: str):
    cur.execute(
        """
        SELECT i.id, i.invoice_no, i.customer_id, c.name AS customer_name, i.status,
               i.subtotal_usd, i.subtotal_lbp, i.discount_total_usd, i.discount_total_lbp,
               i.total_usd, i.total_lbp, i.exchange_rate, i.warehouse_id, w.name AS warehouse_name,
               i.reserve_stock,
               i.pricing_currency, i.settlement_currency,
               i.branch_id,
               i.receipt_no, i.receipt_seq, i.receipt_printer, i.receipt_printed_at, i.receipt_meta,
               i.invoice_date, i.due_date, i.created_at
        FROM sales_invoices i
        LEFT JOIN customers c
          ON c.company_id = i.company_id AND c.id = i.customer_id
        LEFT JOIN warehouses w
          ON w.company_id = i.company_id AND w.id = i.warehouse_id
        WHERE i.company_id = %s AND i.id = %s AND i.device_id = %s
        """,
        (company_id, invoice_id, device_id),
    )
    inv = cur.fetchone()
    if not inv:
        return None

    cur.execute(
        """
        SELECT l.id, l.item_id, it.sku AS item_sku, it.name AS item_name,
               it.tax_code_id AS item_tax_code_id,
               l.qty, l.uom, l.qty_factor, l.qty_entered,
               l.unit_price_usd, l.unit_price_lbp,
               l.unit_price_entered_usd, l.unit_price_entered_lbp,
               l.pre_discount_unit_price_usd, l.pre_discount_unit_price_lbp,
               l.discount_pct, l.discount_amount_usd, l.discount_amount_lbp,
               l.applied_promotion_id, l.applied_promotion_item_id, l.applied_price_list_id,
               l.line_total_usd, l.line_total_lbp
        FROM sales_invoice_lines l
        LEFT JOIN items it
          ON it.company_id = %s AND it.id = l.item_id
        WHERE l.invoice_id = %s
        ORDER BY l.id
        """,
        (company_id, invoice_id),
    )
    lines = cur.fetchall()

    cur.execute(
        """
        SELECT id, method, amount_usd, amount_lbp,
               tender_usd, tender_lbp,
               reference, auth_code, provider, settlement_currency, captured_at,
               voided_at, void_reason,
               created_at
        FROM sales_payments
        WHERE invoice_id = %s AND voided_at IS NULL
        ORDER BY created_at ASC
        """,
        (invoice_id,),
    )
    payments = cur.fetchall()

    cur.execute(
        """
        SELECT id, tax_code_id, base_usd, base_lbp, tax_usd, tax_lbp, tax_date, created_at
        FROM tax_lines
        WHERE company_id = %s AND source_type = 'sales_invoice' AND source_id = %s
        ORDER BY created_at ASC
        """,
        (company_id, invoice_id),
    )
    tax_lines = cur.fetchall()

    return {
        "invoice": inv,
        "lines": lines,
        "payments": payments,
        "tax_lines": tax_lines,
        "print_policy": _load_print_policy(cur, company_id),
    }


@router.get("/sales-invoices/{invoice_id}")
def pos_get_sales_invoice(invoice_id: str, device=Depends(require_device)):
    """
    Device-scoped Sales Invoice detail for printing/export flows.
    Restricted to invoices created by the same device.
    """
    invoice_id = _normalize_required_uuid_text(invoice_id, "invoice_id")
    company_id = str(device["company_id"])
    device_id = str(device["device_id"])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            detail = _fetch_pos_sales_invoice_detail(cur, company_id, invoice_id, device_id)
            if not detail:
                raise HTTPException(status_code=404, detail="invoice not found")
            return detail


@router.get("/receipts/last")
def pos_get_last_receipt(device=Depends(require_device)):
    company_id = str(device["company_id"])
    device_id = str(device["device_id"])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id
                FROM sales_invoices
                WHERE company_id = %s
                  AND device_id = %s
                  AND status = 'posted'
                ORDER BY
                  COALESCE(receipt_seq, 0) DESC,
                  COALESCE(receipt_printed_at, created_at) DESC,
                  created_at DESC
                LIMIT 1
                """,
                (company_id, device_id),
            )
            row = cur.fetchone()
            if not row:
                return {"receipt": None}
            detail = _fetch_pos_sales_invoice_detail(cur, company_id, str(row["id"]), device_id)
            return {"receipt": detail}


def _fetch_pos_sales_return_detail(cur, company_id: str, return_id: str, device_id: str):
    cur.execute(
        """
        SELECT r.id, r.return_no, r.invoice_id, r.warehouse_id, w.name AS warehouse_name,
               r.device_id, r.shift_id, r.refund_method, r.branch_id,
               r.reason_id, r.reason, r.return_condition,
               r.restocking_fee_usd, r.restocking_fee_lbp, r.restocking_fee_reason,
               r.status, r.total_usd, r.total_lbp, r.exchange_rate, r.created_at
        FROM sales_returns r
        LEFT JOIN warehouses w
          ON w.company_id = r.company_id AND w.id = r.warehouse_id
        WHERE r.company_id = %s
          AND r.id = %s
          AND r.device_id = %s
        """,
        (company_id, return_id, device_id),
    )
    ret = cur.fetchone()
    if not ret:
        return None

    cur.execute(
        """
        SELECT id, item_id, qty,
               unit_price_usd, unit_price_lbp, line_total_usd, line_total_lbp,
               unit_cost_usd, unit_cost_lbp,
               reason_id, line_condition
        FROM sales_return_lines
        WHERE company_id = %s AND sales_return_id = %s
        ORDER BY id
        """,
        (company_id, return_id),
    )
    lines = cur.fetchall()

    cur.execute(
        """
        SELECT id, tax_code_id, base_usd, base_lbp, tax_usd, tax_lbp, tax_date, created_at
        FROM tax_lines
        WHERE company_id = %s AND source_type = 'sales_return' AND source_id = %s
        ORDER BY created_at ASC
        """,
        (company_id, return_id),
    )
    tax_lines = cur.fetchall()

    cur.execute(
        """
        SELECT id, method, amount_usd, amount_lbp, settlement_currency,
               bank_account_id, reference, provider, auth_code, captured_at,
               source_type, source_id, created_at
        FROM sales_refunds
        WHERE company_id = %s AND sales_return_id = %s
        ORDER BY created_at ASC, id ASC
        """,
        (company_id, return_id),
    )
    refunds = cur.fetchall()
    return {"return": ret, "lines": lines, "tax_lines": tax_lines, "refunds": refunds}


@router.get("/sales-returns/last")
def pos_get_last_sales_return(device=Depends(require_device)):
    company_id = str(device["company_id"])
    device_id = str(device["device_id"])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id
                FROM sales_returns
                WHERE company_id = %s
                  AND device_id = %s
                  AND status = 'posted'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (company_id, device_id),
            )
            row = cur.fetchone()
            if not row:
                return {"receipt": None}
            detail = _fetch_pos_sales_return_detail(cur, company_id, str(row["id"]), device_id)
            return {"receipt": detail}


@router.get("/sales-returns/by-event/{event_id}")
def pos_get_sales_return_by_event(event_id: str, device=Depends(require_device)):
    event_id = _normalize_required_uuid_text(event_id, "event_id")
    company_id = str(device["company_id"])
    device_id = str(device["device_id"])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id
                FROM sales_returns
                WHERE company_id = %s
                  AND device_id = %s
                  AND source_event_id = %s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (company_id, device_id, event_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="return not found")
            detail = _fetch_pos_sales_return_detail(cur, company_id, str(row["id"]), device_id)
            if not detail:
                raise HTTPException(status_code=404, detail="return not found")
            return detail


@router.get("/sales-returns/{return_id}")
def pos_get_sales_return(return_id: str, device=Depends(require_device)):
    return_id = _normalize_required_uuid_text(return_id, "return_id")
    company_id = str(device["company_id"])
    device_id = str(device["device_id"])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            detail = _fetch_pos_sales_return_detail(cur, company_id, return_id, device_id)
            if not detail:
                raise HTTPException(status_code=404, detail="return not found")
            return detail

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
    with get_conn() as conn:
        set_company_context(conn, str(device["company_id"]))
        with conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    UPDATE pos_devices
                    SET last_seen_at = now(),
                        last_seen_status = %s
                    WHERE company_id = %s AND id = %s
                    """,
                    (status, device["company_id"], device["device_id"]),
                )
            except Exception:
                pass
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
            cash_methods, cash_methods_norm = _load_cash_methods(cur, str(device["company_id"]))
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
            if row:
                expected_usd, expected_lbp = _expected_cash(
                    cur,
                    str(device["company_id"]),
                    str(device["device_id"]),
                    str(row["id"]),
                    row["opened_at"],
                    row["opening_cash_usd"],
                    row["opening_cash_lbp"],
                    cash_methods_norm=cash_methods_norm,
                )
                row["expected_closing_cash_usd"] = expected_usd
                row["expected_closing_cash_lbp"] = expected_lbp
            return {
                "shift": row,
                "cash_methods": cash_methods,
                "has_cash_method_mapping": bool(cash_methods),
            }


@router.post("/shifts/open")
def open_shift(data: ShiftOpenIn, device=Depends(require_device)):
    _assert_non_negative_shift_cash(data.opening_cash_usd, data.opening_cash_lbp, "opening")
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cash_methods, cash_methods_norm = _load_cash_methods(cur, str(device["company_id"]))
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
            return {
                "shift": cur.fetchone(),
                "cash_methods": cash_methods,
                "has_cash_method_mapping": bool(cash_methods),
            }


def _expected_cash(
    cur,
    company_id: str,
    device_id: str,
    shift_id: Optional[str],
    opened_at,
    opening_cash_usd: Decimal,
    opening_cash_lbp: Decimal,
    cash_methods_norm: Optional[list[str]] = None,
):
    if cash_methods_norm is None:
        _cash_methods, cash_methods_norm = _load_cash_methods(cur, company_id)
    sales_usd = Decimal("0")
    sales_lbp = Decimal("0")
    if cash_methods_norm:
        if shift_id:
            sql = """
                SELECT COALESCE(SUM(sp.amount_usd), 0) AS usd,
                       COALESCE(SUM(sp.amount_lbp), 0) AS lbp
                FROM sales_payments sp
                JOIN sales_invoices si ON si.id = sp.invoice_id
                WHERE si.company_id = %s AND si.shift_id = %s
                  AND lower(sp.method) = ANY(%s)
                  AND sp.voided_at IS NULL
            """
            params = [company_id, shift_id, cash_methods_norm]
        else:
            sql = """
                SELECT COALESCE(SUM(sp.amount_usd), 0) AS usd,
                       COALESCE(SUM(sp.amount_lbp), 0) AS lbp
                FROM sales_payments sp
                JOIN sales_invoices si ON si.id = sp.invoice_id
                WHERE si.company_id = %s AND si.device_id = %s
                  AND si.created_at >= %s
                  AND lower(sp.method) = ANY(%s)
                  AND sp.voided_at IS NULL
            """
            params = [company_id, device_id, opened_at, cash_methods_norm]
        cur.execute(sql, params)
        row = cur.fetchone() or {}
        sales_usd = Decimal(str(row.get("usd") or 0))
        sales_lbp = Decimal(str(row.get("lbp") or 0))

    refunds_usd = Decimal("0")
    refunds_lbp = Decimal("0")
    if cash_methods_norm:
        if shift_id:
            cur.execute(
                """
                SELECT COALESCE(SUM(rf.amount_usd), 0) AS usd,
                       COALESCE(SUM(rf.amount_lbp), 0) AS lbp
                FROM sales_refunds rf
                JOIN sales_returns sr ON sr.id = rf.sales_return_id
                WHERE sr.company_id = %s
                  AND sr.shift_id = %s
                  AND sr.status = 'posted'
                  AND lower(rf.method) = ANY(%s)
                """,
                (company_id, shift_id, cash_methods_norm),
            )
        else:
            cur.execute(
                """
                SELECT COALESCE(SUM(rf.amount_usd), 0) AS usd,
                       COALESCE(SUM(rf.amount_lbp), 0) AS lbp
                FROM sales_refunds rf
                JOIN sales_returns sr ON sr.id = rf.sales_return_id
                WHERE sr.company_id = %s
                  AND sr.device_id = %s
                  AND sr.created_at >= %s
                  AND sr.status = 'posted'
                  AND lower(rf.method) = ANY(%s)
                """,
                (company_id, device_id, opened_at, cash_methods_norm),
            )
        rrow = cur.fetchone() or {}
        refunds_usd = Decimal(str(rrow.get("usd") or 0))
        refunds_lbp = Decimal(str(rrow.get("lbp") or 0))

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

    expected_usd = Decimal(str(opening_cash_usd or 0)) + sales_usd + movements_usd - refunds_usd
    expected_lbp = Decimal(str(opening_cash_lbp or 0)) + sales_lbp + movements_lbp - refunds_lbp
    return expected_usd, expected_lbp


@router.post("/shifts/{shift_id}/close")
def close_shift(shift_id: str, data: ShiftCloseIn, device=Depends(require_device)):
    _assert_non_negative_shift_cash(data.closing_cash_usd, data.closing_cash_lbp, "closing")
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            return _close_shift_impl(
                cur=cur,
                company_id=str(device["company_id"]),
                shift_id=shift_id,
                data=data,
                device_id=str(device["device_id"]),
                closed_by_user_id=None,
            )


def _close_shift_impl(
    *,
    cur,
    company_id: str,
    shift_id: str,
    data: ShiftCloseIn,
    device_id: Optional[str],
    closed_by_user_id: Optional[str],
):
    cash_methods, cash_methods_norm = _load_cash_methods(cur, company_id)
    if device_id:
        cur.execute(
            """
            SELECT id, opened_at, opening_cash_usd, opening_cash_lbp
            FROM pos_shifts
            WHERE id = %s AND company_id = %s AND device_id = %s AND status = 'open'
            """,
            (shift_id, company_id, device_id),
        )
    else:
        cur.execute(
            """
            SELECT id, device_id, opened_at, opening_cash_usd, opening_cash_lbp
            FROM pos_shifts
            WHERE id = %s AND company_id = %s AND status = 'open'
            """,
            (shift_id, company_id),
        )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="open shift not found")

    effective_device_id = device_id or str(row.get("device_id") or "")
    expected_usd, expected_lbp = _expected_cash(
        cur,
        company_id,
        effective_device_id,
        shift_id,
        row["opened_at"],
        row["opening_cash_usd"],
        row["opening_cash_lbp"],
        cash_methods_norm=cash_methods_norm,
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
            closed_by = COALESCE(%s, closed_by),
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
            closed_by_user_id,
            data.notes,
            shift_id,
        ),
    )
    return {
        "shift": cur.fetchone(),
        "cash_methods": cash_methods,
        "has_cash_method_mapping": bool(cash_methods),
    }


@router.post("/shifts/{shift_id}/close-admin", dependencies=[Depends(require_permission("pos:manage"))])
def close_shift_admin(
    shift_id: str,
    data: ShiftCloseIn,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
    user=Depends(get_current_user),
):
    _assert_non_negative_shift_cash(data.closing_cash_usd, data.closing_cash_lbp, "closing")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            return _close_shift_impl(
                cur=cur,
                company_id=company_id,
                shift_id=shift_id,
                data=data,
                device_id=None,
                closed_by_user_id=(user.get("user_id") if isinstance(user, dict) else None),
            )


@router.get("/shifts/{shift_id}/cash-reconciliation", dependencies=[Depends(require_permission("pos:manage"))])
def shift_cash_reconciliation(shift_id: str, company_id: str = Depends(get_company_id), _auth=Depends(require_company_access)):
    """
    Admin drill-down: expected vs counted cash for a shift, including sales, refunds and cash movements.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, device_id, status, opened_at,
                       opening_cash_usd, opening_cash_lbp,
                       closed_at,
                       closing_cash_usd, closing_cash_lbp,
                       expected_cash_usd, expected_cash_lbp,
                       variance_usd, variance_lbp,
                       notes
                FROM pos_shifts
                WHERE company_id=%s AND id=%s
                """,
                (company_id, shift_id),
            )
            sh = cur.fetchone()
            if not sh:
                raise HTTPException(status_code=404, detail="shift not found")

            cash_methods, cash_methods_norm = _load_cash_methods(cur, company_id)

            sales_usd = Decimal("0")
            sales_lbp = Decimal("0")
            refunds_usd = Decimal("0")
            refunds_lbp = Decimal("0")
            if cash_methods_norm:
                cur.execute(
                    """
                    SELECT COALESCE(SUM(sp.amount_usd), 0) AS usd,
                           COALESCE(SUM(sp.amount_lbp), 0) AS lbp
                    FROM sales_payments sp
                    JOIN sales_invoices si ON si.id = sp.invoice_id
                    WHERE si.company_id = %s AND si.shift_id = %s
                      AND lower(sp.method) = ANY(%s)
                      AND sp.voided_at IS NULL
                    """,
                    (company_id, shift_id, cash_methods_norm),
                )
                row = cur.fetchone() or {}
                sales_usd = Decimal(str(row.get("usd") or 0))
                sales_lbp = Decimal(str(row.get("lbp") or 0))

                cur.execute(
                    """
                    SELECT COALESCE(SUM(rf.amount_usd), 0) AS usd,
                           COALESCE(SUM(rf.amount_lbp), 0) AS lbp
                    FROM sales_refunds rf
                    JOIN sales_returns sr ON sr.id = rf.sales_return_id
                    WHERE sr.company_id = %s
                      AND sr.shift_id = %s
                      AND sr.status = 'posted'
                      AND lower(rf.method) = ANY(%s)
                    """,
                    (company_id, shift_id, cash_methods_norm),
                )
                row = cur.fetchone() or {}
                refunds_usd = Decimal(str(row.get("usd") or 0))
                refunds_lbp = Decimal(str(row.get("lbp") or 0))

            cur.execute(
                """
                SELECT movement_type,
                       COALESCE(SUM(amount_usd), 0) AS usd,
                       COALESCE(SUM(amount_lbp), 0) AS lbp
                FROM pos_cash_movements
                WHERE company_id=%s AND shift_id=%s
                GROUP BY movement_type
                ORDER BY movement_type
                """,
                (company_id, shift_id),
            )
            movements = cur.fetchall()

            net_mov_usd = Decimal("0")
            net_mov_lbp = Decimal("0")
            for m in movements:
                t = (m.get("movement_type") or "").strip().lower()
                sign = Decimal("1") if t == "cash_in" else Decimal("-1")
                net_mov_usd += sign * Decimal(str(m.get("usd") or 0))
                net_mov_lbp += sign * Decimal(str(m.get("lbp") or 0))

            opening_usd = Decimal(str(sh.get("opening_cash_usd") or 0))
            opening_lbp = Decimal(str(sh.get("opening_cash_lbp") or 0))
            expected_usd = opening_usd + sales_usd + net_mov_usd - refunds_usd
            expected_lbp = opening_lbp + sales_lbp + net_mov_lbp - refunds_lbp

            return {
                "shift": sh,
                "cash_methods": cash_methods,
                "has_cash_method_mapping": bool(cash_methods),
                "sales_cash_usd": sales_usd,
                "sales_cash_lbp": sales_lbp,
                "refunds_cash_usd": refunds_usd,
                "refunds_cash_lbp": refunds_lbp,
                "cash_movements": movements,
                "cash_movements_net_usd": net_mov_usd,
                "cash_movements_net_lbp": net_mov_lbp,
                "expected_computed_usd": expected_usd,
                "expected_computed_lbp": expected_lbp,
            }


@router.get("/shifts/variance-alerts", dependencies=[Depends(require_permission("pos:manage"))])
def list_shift_variance_alerts(
    days: int = 1,
    min_variance_usd: Decimal = Decimal("20"),
    min_variance_lbp: Decimal = Decimal("2000000"),
    limit: int = 100,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
):
    if days < 1 or days > 60:
        raise HTTPException(status_code=400, detail="days must be between 1 and 60")
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 1000")
    if min_variance_usd < 0 or min_variance_lbp < 0:
        raise HTTPException(status_code=400, detail="variance thresholds must be >= 0")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.device_id, d.device_code, s.opened_at, s.closed_at,
                       s.opening_cash_usd, s.opening_cash_lbp,
                       s.expected_cash_usd, s.expected_cash_lbp,
                       s.closing_cash_usd, s.closing_cash_lbp,
                       s.variance_usd, s.variance_lbp
                FROM pos_shifts s
                LEFT JOIN pos_devices d
                  ON d.company_id = s.company_id
                 AND d.id = s.device_id
                WHERE s.company_id = %s
                  AND s.status = 'closed'
                  AND s.closed_at >= now() - (%s::int * interval '1 day')
                  AND (
                    abs(COALESCE(s.variance_usd, 0)) >= %s
                    OR abs(COALESCE(s.variance_lbp, 0)) >= %s
                  )
                ORDER BY s.closed_at DESC NULLS LAST
                LIMIT %s
                """,
                (company_id, days, min_variance_usd, min_variance_lbp, limit),
            )
            rows = cur.fetchall() or []

    max_abs_usd = Decimal("0")
    max_abs_lbp = Decimal("0")
    for row in rows:
        abs_usd = abs(Decimal(str(row.get("variance_usd") or 0)))
        abs_lbp = abs(Decimal(str(row.get("variance_lbp") or 0)))
        if abs_usd > max_abs_usd:
            max_abs_usd = abs_usd
        if abs_lbp > max_abs_lbp:
            max_abs_lbp = abs_lbp

    return {
        "days": days,
        "thresholds": {"usd": min_variance_usd, "lbp": min_variance_lbp},
        "alerts_count": len(rows),
        "max_abs_variance_usd": max_abs_usd,
        "max_abs_variance_lbp": max_abs_lbp,
        "alerts": rows,
    }


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
    user_id: Optional[str] = None


class CashierUpdate(BaseModel):
    name: Optional[str] = None
    pin: Optional[str] = None
    is_active: Optional[bool] = None
    user_id: Optional[str] = None


class CashierVerifyIn(BaseModel):
    pin: str
    cashier_id: Optional[str] = None


@router.get("/cashiers", dependencies=[Depends(require_permission("pos:manage"))])
def list_cashiers(company_id: str = Depends(get_company_id), _auth=Depends(require_company_access)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            has_user_id_col = _has_pos_cashiers_user_id_column(cur)
            if has_user_id_col:
                cur.execute(
                    """
                    SELECT c.id,
                           c.name,
                           c.user_id,
                           c.is_active,
                           c.updated_at,
                           u.email AS user_email,
                           u.full_name AS user_full_name
                    FROM pos_cashiers c
                    LEFT JOIN users u ON u.id = c.user_id
                    WHERE c.company_id = %s
                    ORDER BY c.name
                    """,
                    (company_id,),
                )
            else:
                cur.execute(
                    """
                    SELECT id, name, NULL::uuid AS user_id, is_active, updated_at,
                           NULL::text AS user_email, NULL::text AS user_full_name
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
    user_id = _normalize_optional_uuid_text(data.user_id)
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            has_user_id_col = _has_pos_cashiers_user_id_column(cur)
            if user_id and not has_user_id_col:
                raise HTTPException(status_code=503, detail="cashier user links not available (run latest migrations)")
            _ensure_company_users_exist(cur, company_id, [user_id] if user_id else [])
            try:
                if has_user_id_col:
                    cur.execute(
                        """
                        INSERT INTO pos_cashiers (id, company_id, name, pin_hash, is_active, user_id)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s)
                        RETURNING id
                        """,
                        (company_id, data.name.strip(), hash_pin(pin), data.is_active, user_id),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO pos_cashiers (id, company_id, name, pin_hash, is_active)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s)
                        RETURNING id
                        """,
                        (company_id, data.name.strip(), hash_pin(pin), data.is_active),
                    )
            except UniqueViolation:
                raise HTTPException(status_code=409, detail="employee already linked to another cashier")
            return {"id": cur.fetchone()["id"]}


@router.patch("/cashiers/{cashier_id}", dependencies=[Depends(require_permission("pos:manage"))])
def update_cashier(cashier_id: str, data: CashierUpdate, company_id: str = Depends(get_company_id), _auth=Depends(require_company_access)):
    patch = data.model_dump(exclude_unset=True)
    if not patch:
        return {"ok": True}

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            has_user_id_col = _has_pos_cashiers_user_id_column(cur)
            fields = []
            params = []
            if "name" in patch:
                next_name = (patch.get("name") or "").strip()
                if not next_name:
                    raise HTTPException(status_code=400, detail="name is required")
                fields.append("name = %s")
                params.append(next_name)
            if "is_active" in patch:
                fields.append("is_active = %s")
                params.append(bool(patch.get("is_active")))
            if "pin" in patch:
                pin = (patch.get("pin") or "").strip()
                if len(pin) < 4:
                    raise HTTPException(status_code=400, detail="pin must be at least 4 digits")
                fields.append("pin_hash = %s")
                params.append(hash_pin(pin))
            if "user_id" in patch:
                if not has_user_id_col:
                    raise HTTPException(status_code=503, detail="cashier user links not available (run latest migrations)")
                next_user_id = _normalize_optional_uuid_text(patch.get("user_id"))
                _ensure_company_users_exist(cur, company_id, [next_user_id] if next_user_id else [])
                fields.append("user_id = %s")
                params.append(next_user_id)
            if not fields:
                return {"ok": True}

            params.extend([company_id, cashier_id])
            try:
                cur.execute(
                    f"""
                    UPDATE pos_cashiers
                    SET {', '.join(fields)}, updated_at = now()
                    WHERE company_id = %s AND id = %s
                    RETURNING id
                    """,
                    params,
                )
            except UniqueViolation:
                raise HTTPException(status_code=409, detail="employee already linked to another cashier")
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="cashier not found")
            return {"ok": True}


def _eligible_cashiers_for_device(cur, company_id: str, device_id: str):
    has_cashier_assignments_table = _has_pos_device_cashiers_table(cur)
    has_user_assignments_table = _has_pos_device_users_table(cur)
    has_cashier_user_id_column = _has_pos_cashiers_user_id_column(cur)

    has_cashier_assignments = False
    if has_cashier_assignments_table:
        cur.execute(
            """
            SELECT EXISTS (
              SELECT 1
              FROM pos_device_cashiers
              WHERE company_id = %s AND device_id = %s
            ) AS ok
            """,
            (company_id, device_id),
        )
        has_cashier_assignments = bool((cur.fetchone() or {}).get("ok"))

    has_employee_assignments = False
    if has_user_assignments_table:
        cur.execute(
            """
            SELECT EXISTS (
              SELECT 1
              FROM pos_device_users
              WHERE company_id = %s AND device_id = %s
            ) AS ok
            """,
            (company_id, device_id),
        )
        has_employee_assignments = bool((cur.fetchone() or {}).get("ok"))

    # If employee assignments exist but cashier->employee link is unavailable,
    # treat this as an empty mapping until migrations are applied.
    if has_employee_assignments and not has_cashier_user_id_column:
        return []

    # Safety net: if employee assignments are enabled but no active cashier in this
    # company is linked to a user yet, do not block login entirely.
    if has_employee_assignments and has_cashier_user_id_column:
        cur.execute(
            """
            SELECT EXISTS (
              SELECT 1
              FROM pos_cashiers c
              WHERE c.company_id = %s
                AND c.is_active = true
                AND c.user_id IS NOT NULL
            ) AS ok
            """,
            (company_id,),
        )
        has_any_linked_cashier = bool((cur.fetchone() or {}).get("ok"))
        if not has_any_linked_cashier:
            has_employee_assignments = False

    user_id_select = "c.user_id" if has_cashier_user_id_column else "NULL::uuid AS user_id"
    joins = []
    params = []
    if has_cashier_assignments:
        joins.append(
            """
            JOIN pos_device_cashiers dc
              ON dc.company_id = c.company_id
             AND dc.cashier_id = c.id
             AND dc.device_id = %s
            """
        )
        params.append(device_id)
    if has_employee_assignments:
        joins.append(
            """
            JOIN pos_device_users du
              ON du.company_id = c.company_id
             AND du.user_id = c.user_id
             AND du.device_id = %s
            """
        )
        params.append(device_id)
    params.append(company_id)

    cur.execute(
        f"""
        SELECT c.id, c.name, c.pin_hash, c.is_active, c.updated_at, {user_id_select}
        FROM pos_cashiers c
        {' '.join(joins)}
        WHERE c.company_id = %s
          AND c.is_active = true
        ORDER BY c.name
        """,
        params,
    )
    rows = cur.fetchall()
    if rows:
        return rows

    # Safety net: if assignment joins produced no rows, avoid a hard cashier lockout.
    # Fallback order: explicit cashier assignments, then all active cashiers.
    if has_cashier_assignments:
        cur.execute(
            """
            SELECT c.id, c.name, c.pin_hash, c.is_active, c.updated_at, c.user_id
            FROM pos_cashiers c
            JOIN pos_device_cashiers dc
              ON dc.company_id = c.company_id
             AND dc.cashier_id = c.id
             AND dc.device_id = %s
            WHERE c.company_id = %s
              AND c.is_active = true
            ORDER BY c.name
            """,
            (device_id, company_id),
        )
        rows = cur.fetchall()
        if rows:
            return rows

    cur.execute(
        """
        SELECT c.id, c.name, c.pin_hash, c.is_active, c.updated_at, c.user_id
        FROM pos_cashiers c
        WHERE c.company_id = %s
          AND c.is_active = true
        ORDER BY c.name
        """,
        (company_id,),
    )
    return cur.fetchall()


def _cashier_manager_meta(cur, company_id: str, user_id: Optional[str]) -> dict:
    fallback = {
        "role": None,
        "roles": [],
        "permissions": [],
        "can_manager_approve": False,
        "is_manager": False,
        "is_admin": False,
    }
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return fallback
    try:
        cur.execute(
            """
            SELECT
              COALESCE(array_remove(array_agg(DISTINCT lower(trim(r.name))), NULL), ARRAY[]::text[]) AS roles,
              COALESCE(array_remove(array_agg(DISTINCT lower(trim(p.code))), NULL), ARRAY[]::text[]) AS permissions
            FROM user_roles ur
            JOIN roles r
              ON r.id = ur.role_id
             AND r.company_id = ur.company_id
            LEFT JOIN role_permissions rp
              ON rp.role_id = ur.role_id
            LEFT JOIN permissions p
              ON p.id = rp.permission_id
            WHERE ur.company_id = %s
              AND ur.user_id = %s
            """,
            (company_id, normalized_user_id),
        )
        row = cur.fetchone() or {}
    except Exception:
        # Never fail cashier PIN verification because role metadata is unavailable.
        return fallback
    roles = [str(v or "").strip().lower() for v in list(row.get("roles") or []) if str(v or "").strip()]
    permissions = [str(v or "").strip().lower() for v in list(row.get("permissions") or []) if str(v or "").strip()]
    role_set = set(roles)
    manager_roles = {"manager", "admin", "owner", "supervisor"}
    is_manager = bool(role_set.intersection(manager_roles))
    is_admin = bool(role_set.intersection({"admin", "owner"}))
    can_manager_approve = (
        is_manager
        or "pos:manage" in permissions
        or "users:write" in permissions
        or any(("manager" in p) or ("approve" in p) or ("admin" in p) for p in permissions)
    )
    preferred_role = next((r for r in roles if r in manager_roles), roles[0] if roles else None)
    return {
        "role": preferred_role,
        "roles": roles,
        "permissions": permissions,
        "can_manager_approve": bool(can_manager_approve),
        "is_manager": bool(is_manager),
        "is_admin": bool(is_admin),
    }


@router.get("/cashiers/catalog")
def cashiers_catalog(device=Depends(require_device)):
    """
    Device sync endpoint. Includes PIN hashes so the POS can verify offline.
    """
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            return {"cashiers": _eligible_cashiers_for_device(cur, str(device["company_id"]), str(device["device_id"]))}

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


@router.get("/customers/{customer_id}")
def customer_by_id(customer_id: str, device=Depends(require_device)):
    customer_id = _normalize_required_uuid_text(customer_id, "customer_id")
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
                WHERE company_id = %s AND id = %s
                """,
                (device["company_id"], customer_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="customer not found")
            return {"customer": row}


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
    if limit <= 0 or limit > 10000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 10000")
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


@router.post("/customers")
def create_customer_from_pos(data: PosCustomerCreateIn, device=Depends(require_device)):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    membership_no = (data.membership_no or "").strip() or None
    is_member = bool(data.is_member) if data.is_member is not None else bool(membership_no)
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO customers
                  (id, company_id, code, name, phone, email, party_type, customer_type, assigned_salesperson_user_id, marketing_opt_in,
                   legal_name, tax_id, vat_no, notes,
                   membership_no, is_member, membership_expires_at,
                   payment_terms_days, credit_limit_usd, credit_limit_lbp,
                   price_list_id, is_active)
                VALUES
                  (gen_random_uuid(), %s, NULL, %s, %s, %s, %s, %s, NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0, 0, NULL, %s)
                RETURNING id, name, phone, email,
                          party_type, customer_type, marketing_opt_in,
                          legal_name, tax_id, vat_no, notes,
                          membership_no, is_member, membership_expires_at,
                          payment_terms_days,
                          credit_limit_usd, credit_limit_lbp,
                          credit_balance_usd, credit_balance_lbp,
                          loyalty_points,
                          price_list_id,
                          is_active,
                          updated_at
                """,
                (
                    device["company_id"],
                    name,
                    (data.phone or "").strip() or None,
                    (data.email or "").strip() or None,
                    (data.party_type or "individual").strip() or "individual",
                    (data.customer_type or "retail").strip() or "retail",
                    bool(data.marketing_opt_in),
                    (data.legal_name or "").strip() or None,
                    (data.tax_id or "").strip() or None,
                    (data.vat_no or "").strip() or None,
                    (data.notes or "").strip() or None,
                    membership_no,
                    is_member,
                    data.membership_expires_at,
                    int(data.payment_terms_days or 0),
                    bool(data.is_active),
                ),
            )
            row = cur.fetchone()
            return {"customer": row}


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
    target_cashier_id = _normalize_optional_uuid_text(data.cashier_id)
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            rows = _eligible_cashiers_for_device(cur, str(device["company_id"]), str(device["device_id"]))
            def _cashier_payload(row):
                meta = _cashier_manager_meta(cur, str(device["company_id"]), str(row.get("user_id") or ""))
                return {
                    "cashier": {
                        "id": row["id"],
                        "name": row["name"],
                        "user_id": row.get("user_id"),
                        "role": meta.get("role"),
                        "roles": meta.get("roles") or [],
                        "permissions": meta.get("permissions") or [],
                        "can_manager_approve": bool(meta.get("can_manager_approve")),
                        "is_manager": bool(meta.get("is_manager")),
                        "is_admin": bool(meta.get("is_admin")),
                    }
                }

            if target_cashier_id:
                target_row = None
                for r in rows:
                    if str(r.get("id") or "") == target_cashier_id:
                        target_row = r
                        break
                if not target_row:
                    cur.execute(
                        """
                        SELECT 1
                        FROM pos_cashiers
                        WHERE company_id = %s
                          AND id = %s
                          AND is_active = true
                        LIMIT 1
                        """,
                        (device["company_id"], target_cashier_id),
                    )
                    if cur.fetchone():
                        raise HTTPException(status_code=403, detail="cashier is not assigned to this device")
                    raise HTTPException(status_code=404, detail="cashier not found")
                if not verify_pin(pin, target_row["pin_hash"]):
                    raise HTTPException(status_code=401, detail="invalid pin")
                return _cashier_payload(target_row)

            for r in rows:
                if verify_pin(pin, r["pin_hash"]):
                    return _cashier_payload(r)
            # Better operator UX: if PIN is valid for an active cashier but that cashier
            # is filtered out by device assignments, return a specific error.
            eligible_ids = {str(r.get("id")) for r in rows if r.get("id")}
            cur.execute(
                """
                SELECT id, pin_hash
                FROM pos_cashiers
                WHERE company_id = %s
                  AND is_active = true
                ORDER BY updated_at DESC
                """,
                (device["company_id"],),
            )
            for row in cur.fetchall():
                row_id = str(row.get("id") or "").strip()
                if row_id and row_id in eligible_ids:
                    continue
                if verify_pin(pin, row.get("pin_hash")):
                    raise HTTPException(status_code=403, detail="cashier is not assigned to this device")
    raise HTTPException(status_code=401, detail="invalid pin")

@router.get("/cash-movements/admin", dependencies=[Depends(require_permission("pos:manage"))])
def list_cash_movements_admin(
    shift_id: str,
    limit: int = 200,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
):
    shift_id = _normalize_required_uuid_text(shift_id, "shift_id")
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
            _cash_methods, cash_methods_norm = _load_cash_methods(cur, company_id)
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
            rows = cur.fetchall() or []
            for row in rows:
                if str(row.get("status") or "").lower() != "open":
                    continue
                expected_usd, expected_lbp = _expected_cash(
                    cur,
                    company_id,
                    str(row.get("device_id") or ""),
                    str(row.get("id") or ""),
                    row.get("opened_at"),
                    row.get("opening_cash_usd"),
                    row.get("opening_cash_lbp"),
                    cash_methods_norm=cash_methods_norm,
                )
                row["expected_cash_usd"] = expected_usd
                row["expected_cash_lbp"] = expected_lbp
            return {"shifts": rows}
