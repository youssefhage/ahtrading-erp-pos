from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
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


class PosCustomerCreateIn(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    membership_no: Optional[str] = None
    party_type: Literal["individual", "business"] = "individual"
    customer_type: Literal["retail", "wholesale", "b2b"] = "retail"
    payment_terms_days: int = 0
    is_active: bool = True


class PosDeviceUpdateIn(BaseModel):
    device_code: Optional[str] = None
    branch_id: Optional[str] = None


class PosDeviceCashierAssignmentsIn(BaseModel):
    cashier_ids: List[str] = []


class PosDeviceEmployeeAssignmentsIn(BaseModel):
    user_ids: List[str] = []


def _normalize_optional_uuid_text(value: Optional[str]) -> Optional[str]:
    normalized = str(value or "").strip()
    return normalized or None


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
        JOIN users u ON u.id = ur.user_id
        WHERE ur.company_id = %s
          AND ur.user_id = ANY(%s)
          AND COALESCE(u.is_active, true) = true
        """,
        (company_id, user_ids),
    )
    found = {str(r["id"]) for r in cur.fetchall()}
    missing = [uid for uid in user_ids if uid not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"user not found or inactive: {missing[0]}")


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
    next_branch_id = _normalize_optional_uuid_text(branch_id)

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
        next_branch_id = _normalize_optional_uuid_text(patch.get("branch_id"))
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
    cashier_ids = [str(c or "").strip() for c in (data.cashier_ids or []) if str(c or "").strip()]
    cashier_ids = list(dict.fromkeys(cashier_ids))

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
                          AND id = ANY(%s)
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
    user_ids = [str(u or "").strip() for u in (data.user_ids or []) if str(u or "").strip()]
    user_ids = list(dict.fromkeys(user_ids))

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


@router.post("/devices/{device_id}/deactivate", dependencies=[Depends(require_permission("pos:manage"))])
def deactivate_device(
    device_id: str,
    company_id: str = Depends(get_company_id),
    _auth=Depends(require_company_access),
    user=Depends(get_current_user),
):
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


class OutboxProcessOneIn(BaseModel):
    event_id: uuid.UUID


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

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, device_id, event_type, payload_json, status, attempt_count
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

                # If it's already processed, just return the linked document (if any).
                if status == "processed":
                    inv = None
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
                    return {
                        "ok": True,
                        "event_id": event_id,
                        "event_type": event_type,
                        "status": "processed",
                        "invoice_id": (str(inv["id"]) if inv else None),
                        "invoice_no": (inv.get("invoice_no") if inv else None),
                    }

                payload = row.get("payload_json") or {}
                if isinstance(payload, str):
                    try:
                        payload = json.loads(payload)
                    except Exception:
                        payload = {}

                try:
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
                            error_message = NULL
                        WHERE id = %s
                        """,
                        (event_id,),
                    )
                except Exception as ex:
                    # Keep the same attempt/dead semantics as the worker.
                    next_attempt = attempt_count + 1
                    max_attempts = 5
                    next_status = "dead" if next_attempt >= max_attempts else "failed"
                    cur.execute(
                        """
                        UPDATE pos_events_outbox
                        SET status = %s,
                            attempt_count = %s,
                            error_message = %s
                        WHERE id = %s
                        """,
                        (next_status, next_attempt, str(ex), event_id),
                    )
                    raise HTTPException(status_code=409, detail=str(ex))

                inv = None
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

                return {
                    "ok": True,
                    "event_id": event_id,
                    "event_type": event_type,
                    "status": "processed",
                    "invoice_id": (str(inv["id"]) if inv else None),
                    "invoice_no": (inv.get("invoice_no") if inv else None),
                }

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
                          'qty_factor', b.qty_factor,
                          'uom_code', b.uom_code,
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
                            'qty_factor', b.qty_factor,
                            'uom_code', b.uom_code,
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
            vat = vat_codes[0] if vat_codes else None

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

    return {
        "company_id": device["company_id"],
        "device": dev,
        "company": company,
        "default_warehouse_id": (wh["id"] if wh else None),
        "vat": vat,
        "vat_codes": vat_codes,
        "payment_methods": pay_methods,
        "default_price_list_id": default_pl_id,
        "inventory_policy": inventory_policy,
    }


@router.get("/sales-invoices/{invoice_id}")
def pos_get_sales_invoice(invoice_id: str, device=Depends(require_device)):
    """
    Device-scoped Sales Invoice detail for printing/export flows.
    Restricted to invoices created by the same device.
    """
    company_id = str(device["company_id"])
    device_id = str(device["device_id"])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
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
                raise HTTPException(status_code=404, detail="invoice not found")

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

            return {"invoice": inv, "lines": lines, "payments": payments, "tax_lines": tax_lines}

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

    refunds_usd = Decimal("0")
    refunds_lbp = Decimal("0")
    if shift_id:
        cur.execute(
            """
            SELECT COALESCE(SUM(total_usd), 0) AS usd,
                   COALESCE(SUM(total_lbp), 0) AS lbp
            FROM sales_returns
            WHERE company_id = %s
              AND shift_id = %s
              AND status = 'posted'
              AND refund_method = ANY(%s)
            """,
            (company_id, shift_id, cash_methods),
        )
    else:
        cur.execute(
            """
            SELECT COALESCE(SUM(total_usd), 0) AS usd,
                   COALESCE(SUM(total_lbp), 0) AS lbp
            FROM sales_returns
            WHERE company_id = %s
              AND device_id = %s
              AND created_at >= %s
              AND status = 'posted'
              AND refund_method = ANY(%s)
            """,
            (company_id, device_id, opened_at, cash_methods),
        )
    rrow = cur.fetchone()
    if rrow:
        refunds_usd = Decimal(str(rrow["usd"] or 0))
        refunds_lbp = Decimal(str(rrow["lbp"] or 0))

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

            cur.execute(
                """
                SELECT method
                FROM payment_method_mappings
                WHERE company_id = %s AND role_code = 'CASH'
                """,
                (company_id,),
            )
            cash_methods = [r["method"] for r in cur.fetchall()] or []

            sales_usd = Decimal("0")
            sales_lbp = Decimal("0")
            refunds_usd = Decimal("0")
            refunds_lbp = Decimal("0")
            if cash_methods:
                cur.execute(
                    """
                    SELECT COALESCE(SUM(sp.amount_usd), 0) AS usd,
                           COALESCE(SUM(sp.amount_lbp), 0) AS lbp
                    FROM sales_payments sp
                    JOIN sales_invoices si ON si.id = sp.invoice_id
                    WHERE si.company_id = %s AND si.shift_id = %s AND sp.method = ANY(%s)
                    """,
                    (company_id, shift_id, cash_methods),
                )
                row = cur.fetchone() or {}
                sales_usd = Decimal(str(row.get("usd") or 0))
                sales_lbp = Decimal(str(row.get("lbp") or 0))

                cur.execute(
                    """
                    SELECT COALESCE(SUM(total_usd), 0) AS usd,
                           COALESCE(SUM(total_lbp), 0) AS lbp
                    FROM sales_returns
                    WHERE company_id = %s
                      AND shift_id = %s
                      AND status = 'posted'
                      AND refund_method = ANY(%s)
                    """,
                    (company_id, shift_id, cash_methods),
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
        SELECT c.id, c.name, c.pin_hash, c.is_active, c.updated_at
        FROM pos_cashiers c
        {' '.join(joins)}
        WHERE c.company_id = %s
          AND c.is_active = true
        ORDER BY c.name
        """,
        params,
    )
    return cur.fetchall()


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
                  (gen_random_uuid(), %s, NULL, %s, %s, %s, %s, %s, NULL, false, NULL, NULL, NULL, NULL, %s, false, NULL, %s, 0, 0, NULL, %s)
                RETURNING id, name, phone, email,
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
                    (data.membership_no or "").strip() or None,
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
    with get_conn() as conn:
        set_company_context(conn, device["company_id"])
        with conn.cursor() as cur:
            rows = _eligible_cashiers_for_device(cur, str(device["company_id"]), str(device["device_id"]))
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
