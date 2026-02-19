import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from decimal import Decimal
from typing import Optional, Literal, List
from psycopg import errors as pg_errors
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user

router = APIRouter(prefix="/suppliers", tags=["suppliers"])

PartyType = Literal["individual", "business"]

class SupplierIn(BaseModel):
    code: Optional[str] = None
    name: str
    party_type: PartyType = "business"  # individual|business
    legal_name: Optional[str] = None
    tax_id: Optional[str] = None
    vat_no: Optional[str] = None
    notes: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    payment_terms_days: Optional[int] = None
    bank_name: Optional[str] = None
    bank_account_no: Optional[str] = None
    bank_iban: Optional[str] = None
    bank_swift: Optional[str] = None
    payment_instructions: Optional[str] = None
    is_active: Optional[bool] = None


class BulkSupplierIn(BaseModel):
    code: str
    name: str
    party_type: PartyType = "business"
    phone: Optional[str] = None
    email: Optional[str] = None
    tax_id: Optional[str] = None
    vat_no: Optional[str] = None
    payment_terms_days: Optional[int] = None
    is_active: Optional[bool] = None


class BulkSuppliersIn(BaseModel):
    suppliers: List[BulkSupplierIn]


class ItemSupplierIn(BaseModel):
    item_id: str
    is_primary: bool = False
    lead_time_days: int = 0
    min_order_qty: Decimal = Decimal("0")
    last_cost_usd: Decimal = Decimal("0")
    last_cost_lbp: Decimal = Decimal("0")


@router.get("", dependencies=[Depends(require_permission("suppliers:read"))])
def list_suppliers(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    SELECT id, code, name, phone, email, payment_terms_days, party_type, legal_name, tax_id, vat_no, notes,
                           bank_name, bank_account_no, bank_iban, bank_swift, payment_instructions,
                           is_active
                    FROM suppliers
                    WHERE company_id = %s AND merged_into_id IS NULL
                    ORDER BY name
                    """,
                    (company_id,),
                )
            except pg_errors.UndefinedColumn:
                cur.execute(
                    """
                    SELECT id, code, name, phone, email, payment_terms_days, party_type, legal_name, tax_id, vat_no, notes,
                           bank_name, bank_account_no, bank_iban, bank_swift, payment_instructions,
                           is_active
                    FROM suppliers
                    WHERE company_id = %s
                    ORDER BY name
                    """,
                    (company_id,),
                )
            return {"suppliers": cur.fetchall()}


@router.get("/typeahead", dependencies=[Depends(require_permission("suppliers:read"))])
def typeahead_suppliers(
    q: str = "",
    limit: int = 50,
    include_inactive: bool = False,
    company_id: str = Depends(get_company_id),
):
    qq = (q or "").strip()
    if limit <= 0 or limit > 200:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 200")
    like = f"%{qq}%"
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    SELECT id, code, name, phone, email, is_active
                    FROM suppliers
                    WHERE company_id = %s
                      AND merged_into_id IS NULL
                      AND (%s = true OR is_active = true)
                      AND (
                        %s = ''
                        OR (code IS NOT NULL AND code ILIKE %s)
                        OR name ILIKE %s
                        OR (phone IS NOT NULL AND phone ILIKE %s)
                        OR (email IS NOT NULL AND email ILIKE %s)
                        OR (vat_no IS NOT NULL AND vat_no ILIKE %s)
                        OR (tax_id IS NOT NULL AND tax_id ILIKE %s)
                      )
                    ORDER BY name
                    LIMIT %s
                    """,
                    (company_id, include_inactive, qq, like, like, like, like, like, like, limit),
                )
            except pg_errors.UndefinedColumn:
                cur.execute(
                    """
                    SELECT id, code, name, phone, email, is_active
                    FROM suppliers
                    WHERE company_id = %s
                      AND (%s = true OR is_active = true)
                      AND (
                        %s = ''
                        OR (code IS NOT NULL AND code ILIKE %s)
                        OR name ILIKE %s
                        OR (phone IS NOT NULL AND phone ILIKE %s)
                        OR (email IS NOT NULL AND email ILIKE %s)
                        OR (vat_no IS NOT NULL AND vat_no ILIKE %s)
                        OR (tax_id IS NOT NULL AND tax_id ILIKE %s)
                      )
                    ORDER BY name
                    LIMIT %s
                    """,
                    (company_id, include_inactive, qq, like, like, like, like, like, like, limit),
                )
            return {"suppliers": cur.fetchall()}


@router.get("/{supplier_id}", dependencies=[Depends(require_permission("suppliers:read"))])
def get_supplier(supplier_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, name, phone, email, payment_terms_days, party_type, legal_name, tax_id, vat_no, notes,
                       bank_name, bank_account_no, bank_iban, bank_swift, payment_instructions,
                       is_active
                FROM suppliers
                WHERE company_id = %s AND id = %s
                """,
                (company_id, supplier_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="supplier not found")
            return {"supplier": row}


@router.post("", dependencies=[Depends(require_permission("suppliers:write"))])
def create_supplier(data: SupplierIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            code = (data.code or "").strip() or None
            cur.execute(
                """
                INSERT INTO suppliers
                  (id, company_id, code, name, phone, email, payment_terms_days, party_type, legal_name, tax_id, vat_no, notes,
                   bank_name, bank_account_no, bank_iban, bank_swift, payment_instructions,
                   is_active)
                VALUES
                  (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    company_id,
                    code,
                    data.name,
                    data.phone,
                    data.email,
                    data.payment_terms_days or 0,
                    (data.party_type or 'business'),
                    (data.legal_name or '').strip() or None,
                    (data.tax_id or '').strip() or None,
                    (data.vat_no or '').strip() or None,
                    (data.notes or '').strip() or None,
                    (data.bank_name or "").strip() or None,
                    (data.bank_account_no or "").strip() or None,
                    (data.bank_iban or "").strip() or None,
                    (data.bank_swift or "").strip() or None,
                    (data.payment_instructions or "").strip() or None,
                    bool(data.is_active) if data.is_active is not None else True,
                ),
            )
            return {"id": cur.fetchone()["id"]}


class SupplierUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    party_type: Optional[PartyType] = None
    legal_name: Optional[str] = None
    tax_id: Optional[str] = None
    vat_no: Optional[str] = None
    notes: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    payment_terms_days: Optional[int] = None
    bank_name: Optional[str] = None
    bank_account_no: Optional[str] = None
    bank_iban: Optional[str] = None
    bank_swift: Optional[str] = None
    payment_instructions: Optional[str] = None
    is_active: Optional[bool] = None


@router.patch("/{supplier_id}", dependencies=[Depends(require_permission("suppliers:write"))])
def update_supplier(supplier_id: str, data: SupplierUpdate, company_id: str = Depends(get_company_id)):
    fields = []
    params = []
    payload = data.model_dump(exclude_none=True)
    if "code" in payload:
        payload["code"] = (payload.get("code") or "").strip() or None
    if "legal_name" in payload:
        payload["legal_name"] = (payload.get("legal_name") or "").strip() or None
    if "tax_id" in payload:
        payload["tax_id"] = (payload.get("tax_id") or "").strip() or None
    if "vat_no" in payload:
        payload["vat_no"] = (payload.get("vat_no") or "").strip() or None
    if "notes" in payload:
        payload["notes"] = (payload.get("notes") or "").strip() or None
    if "phone" in payload:
        payload["phone"] = (payload.get("phone") or "").strip() or None
    if "email" in payload:
        payload["email"] = (payload.get("email") or "").strip() or None
    if "bank_name" in payload:
        payload["bank_name"] = (payload.get("bank_name") or "").strip() or None
    if "bank_account_no" in payload:
        payload["bank_account_no"] = (payload.get("bank_account_no") or "").strip() or None
    if "bank_iban" in payload:
        payload["bank_iban"] = (payload.get("bank_iban") or "").strip() or None
    if "bank_swift" in payload:
        payload["bank_swift"] = (payload.get("bank_swift") or "").strip() or None
    if "payment_instructions" in payload:
        payload["payment_instructions"] = (payload.get("payment_instructions") or "").strip() or None
    for k, v in payload.items():
        fields.append(f"{k} = %s")
        params.append(v)
    if not fields:
        return {"ok": True}
    params.extend([company_id, supplier_id])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "SELECT merged_into_id FROM suppliers WHERE company_id=%s AND id=%s",
                    (company_id, supplier_id),
                )
                r = cur.fetchone()
            except pg_errors.UndefinedColumn:
                cur.execute("SELECT 1 AS ok FROM suppliers WHERE company_id=%s AND id=%s", (company_id, supplier_id))
                r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="supplier not found")
            if r.get("merged_into_id"):
                raise HTTPException(status_code=409, detail="Cannot edit a merged supplier")
            cur.execute(
                f"""
                UPDATE suppliers
                SET {', '.join(fields)}
                WHERE company_id = %s AND id = %s
                """,
                params,
            )
            return {"ok": True}


class SupplierMergePreviewIn(BaseModel):
    source_supplier_id: str
    target_supplier_id: str


@router.post("/merge/preview", dependencies=[Depends(require_permission("suppliers:write"))])
def preview_merge_supplier(data: SupplierMergePreviewIn, company_id: str = Depends(get_company_id)):
    if data.source_supplier_id == data.target_supplier_id:
        raise HTTPException(status_code=400, detail="source_supplier_id and target_supplier_id must differ")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, name, phone, email, vat_no, tax_id,
                       bank_name, bank_iban,
                       merged_into_id
                FROM suppliers
                WHERE company_id=%s AND id=ANY(%s)
                """,
                (company_id, [data.source_supplier_id, data.target_supplier_id]),
            )
            rows = {str(r["id"]): r for r in cur.fetchall()}
            src = rows.get(data.source_supplier_id)
            tgt = rows.get(data.target_supplier_id)
            if not src or not tgt:
                raise HTTPException(status_code=404, detail="supplier not found")
            if src.get("merged_into_id") or tgt.get("merged_into_id"):
                raise HTTPException(status_code=409, detail="cannot merge suppliers that are already merged")

            def _count(sql: str) -> int:
                cur.execute(sql, (company_id, data.source_supplier_id))
                return int(cur.fetchone()["n"])

            counts = {
                "purchase_orders": _count("SELECT COUNT(*)::int AS n FROM purchase_orders WHERE company_id=%s AND supplier_id=%s"),
                "goods_receipts": _count("SELECT COUNT(*)::int AS n FROM goods_receipts WHERE company_id=%s AND supplier_id=%s"),
                "supplier_invoices": _count("SELECT COUNT(*)::int AS n FROM supplier_invoices WHERE company_id=%s AND supplier_id=%s"),
                "supplier_credit_notes": _count("SELECT COUNT(*)::int AS n FROM supplier_credit_notes WHERE company_id=%s AND supplier_id=%s"),
                "item_suppliers": _count("SELECT COUNT(*)::int AS n FROM item_suppliers WHERE company_id=%s AND supplier_id=%s"),
                "supplier_item_aliases": _count("SELECT COUNT(*)::int AS n FROM supplier_item_aliases WHERE company_id=%s AND supplier_id=%s"),
                "batches_received": _count("SELECT COUNT(*)::int AS n FROM batches WHERE company_id=%s AND received_supplier_id=%s"),
                "party_contacts": _count("SELECT COUNT(*)::int AS n FROM party_contacts WHERE company_id=%s AND party_kind='supplier' AND party_id=%s"),
                "party_addresses": _count("SELECT COUNT(*)::int AS n FROM party_addresses WHERE company_id=%s AND party_kind='supplier' AND party_id=%s"),
                "attachments": _count("SELECT COUNT(*)::int AS n FROM document_attachments WHERE company_id=%s AND entity_type='supplier' AND entity_id=%s"),
            }

            conflicts = []
            if src.get("code") and tgt.get("code") and src["code"] != tgt["code"]:
                conflicts.append("code")
            if src.get("email") and tgt.get("email") and str(src["email"]).lower() != str(tgt["email"]).lower():
                conflicts.append("email")
            return {"source": src, "target": tgt, "counts": counts, "conflicts": conflicts}


class SupplierMergeExecuteIn(BaseModel):
    source_supplier_id: str
    target_supplier_id: str
    reason: Optional[str] = None


@router.post("/merge", dependencies=[Depends(require_permission("suppliers:write"))])
def merge_supplier(data: SupplierMergeExecuteIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if data.source_supplier_id == data.target_supplier_id:
        raise HTTPException(status_code=400, detail="source_supplier_id and target_supplier_id must differ")
    reason = (data.reason or "").strip() or None
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT *
                    FROM suppliers
                    WHERE company_id=%s AND id=ANY(%s)
                    FOR UPDATE
                    """,
                    (company_id, [data.source_supplier_id, data.target_supplier_id]),
                )
                rows = {str(r["id"]): r for r in cur.fetchall()}
                src = rows.get(data.source_supplier_id)
                tgt = rows.get(data.target_supplier_id)
                if not src or not tgt:
                    raise HTTPException(status_code=404, detail="supplier not found")
                if src.get("merged_into_id") or tgt.get("merged_into_id"):
                    raise HTTPException(status_code=409, detail="cannot merge suppliers that are already merged")

                patch = {}
                for k in [
                    "code",
                    "phone",
                    "email",
                    "party_type",
                    "legal_name",
                    "tax_id",
                    "vat_no",
                    "notes",
                    "payment_terms_days",
                    "bank_name",
                    "bank_account_no",
                    "bank_iban",
                    "bank_swift",
                    "payment_instructions",
                ]:
                    if tgt.get(k) in (None, "", 0) and src.get(k) not in (None, "", 0):
                        patch[k] = src.get(k)

                clear_src = {}
                if src.get("code") and tgt.get("code") and src["code"] != tgt["code"]:
                    clear_src["code"] = None

                if patch:
                    sets = []
                    params = []
                    for k, v in patch.items():
                        sets.append(f"{k}=%s")
                        params.append(v)
                    params.extend([company_id, data.target_supplier_id])
                    cur.execute(
                        f"""
                        UPDATE suppliers
                        SET {', '.join(sets)}
                        WHERE company_id=%s AND id=%s
                        """,
                        params,
                    )

                # Resolve unique conflicts in (company_id,item_id,supplier_id) before re-pointing.
                cur.execute(
                    """
                    DELETE FROM item_suppliers s
                    USING item_suppliers t
                    WHERE s.company_id=%s
                      AND t.company_id=s.company_id
                      AND s.item_id=t.item_id
                      AND s.supplier_id=%s
                      AND t.supplier_id=%s
                    """,
                    (company_id, data.source_supplier_id, data.target_supplier_id),
                )
                cur.execute("UPDATE item_suppliers SET supplier_id=%s WHERE company_id=%s AND supplier_id=%s", (data.target_supplier_id, company_id, data.source_supplier_id))

                # supplier_item_aliases has uniqueness on normalized_code/name; delete conflicts first.
                cur.execute(
                    """
                    DELETE FROM supplier_item_aliases a
                    USING supplier_item_aliases b
                    WHERE a.company_id=%s
                      AND b.company_id=a.company_id
                      AND a.supplier_id=%s
                      AND b.supplier_id=%s
                      AND (
                        (a.normalized_code IS NOT NULL AND a.normalized_code = b.normalized_code)
                        OR (a.normalized_name IS NOT NULL AND a.normalized_name = b.normalized_name)
                      )
                    """,
                    (company_id, data.source_supplier_id, data.target_supplier_id),
                )
                cur.execute("UPDATE supplier_item_aliases SET supplier_id=%s WHERE company_id=%s AND supplier_id=%s", (data.target_supplier_id, company_id, data.source_supplier_id))

                # Re-point core docs + metadata.
                cur.execute("UPDATE purchase_orders SET supplier_id=%s WHERE company_id=%s AND supplier_id=%s", (data.target_supplier_id, company_id, data.source_supplier_id))
                cur.execute("UPDATE goods_receipts SET supplier_id=%s WHERE company_id=%s AND supplier_id=%s", (data.target_supplier_id, company_id, data.source_supplier_id))
                cur.execute("UPDATE supplier_invoices SET supplier_id=%s WHERE company_id=%s AND supplier_id=%s", (data.target_supplier_id, company_id, data.source_supplier_id))
                cur.execute("UPDATE supplier_credit_notes SET supplier_id=%s WHERE company_id=%s AND supplier_id=%s", (data.target_supplier_id, company_id, data.source_supplier_id))
                cur.execute("UPDATE batches SET received_supplier_id=%s WHERE company_id=%s AND received_supplier_id=%s", (data.target_supplier_id, company_id, data.source_supplier_id))
                cur.execute("UPDATE party_contacts SET party_id=%s WHERE company_id=%s AND party_kind='supplier' AND party_id=%s", (data.target_supplier_id, company_id, data.source_supplier_id))
                cur.execute("UPDATE party_addresses SET party_id=%s WHERE company_id=%s AND party_kind='supplier' AND party_id=%s", (data.target_supplier_id, company_id, data.source_supplier_id))
                cur.execute("UPDATE document_attachments SET entity_id=%s WHERE company_id=%s AND entity_type='supplier' AND entity_id=%s", (data.target_supplier_id, company_id, data.source_supplier_id))

                cur.execute(
                    """
                    UPDATE suppliers
                    SET is_active = false,
                        merged_into_id = %s,
                        merged_at = now(),
                        merged_reason = %s
                    WHERE company_id=%s AND id=%s
                    """,
                    (data.target_supplier_id, reason, company_id, data.source_supplier_id),
                )
                if clear_src:
                    sets = []
                    params = []
                    for k, v in clear_src.items():
                        sets.append(f"{k}=%s")
                        params.append(v)
                    params.extend([company_id, data.source_supplier_id])
                    cur.execute(
                        f"UPDATE suppliers SET {', '.join(sets)} WHERE company_id=%s AND id=%s",
                        params,
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'suppliers.merge', 'supplier', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        data.target_supplier_id,
                        json.dumps({"source_supplier_id": data.source_supplier_id, "target_supplier_id": data.target_supplier_id, "reason": reason}),
                    ),
                )
                return {"ok": True, "source_supplier_id": data.source_supplier_id, "target_supplier_id": data.target_supplier_id}


@router.get("/duplicates", dependencies=[Depends(require_permission("suppliers:read"))])
def supplier_duplicates(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    WITH by_email AS (
                      SELECT lower(btrim(email)) AS key,
                             COUNT(*)::int AS n,
                             json_agg(json_build_object('id', id, 'code', code, 'name', name, 'email', email, 'phone', phone, 'is_active', is_active) ORDER BY name) AS rows
                      FROM suppliers
                      WHERE company_id=%s
                        AND merged_into_id IS NULL
                        AND email IS NOT NULL
                        AND btrim(email) <> ''
                      GROUP BY lower(btrim(email))
                      HAVING COUNT(*) > 1
                    ),
                    by_phone AS (
                      SELECT regexp_replace(COALESCE(phone,''), '\\\\D', '', 'g') AS key,
                             COUNT(*)::int AS n,
                             json_agg(json_build_object('id', id, 'code', code, 'name', name, 'email', email, 'phone', phone, 'is_active', is_active) ORDER BY name) AS rows
                      FROM suppliers
                      WHERE company_id=%s
                        AND merged_into_id IS NULL
                        AND phone IS NOT NULL
                        AND btrim(phone) <> ''
                        AND regexp_replace(COALESCE(phone,''), '\\\\D', '', 'g') <> ''
                      GROUP BY regexp_replace(COALESCE(phone,''), '\\\\D', '', 'g')
                      HAVING COUNT(*) > 1
                    )
                    SELECT
                      (SELECT COALESCE(json_agg(json_build_object('key', key, 'n', n, 'suppliers', rows) ORDER BY n DESC), '[]'::json) FROM by_email) AS by_email,
                      (SELECT COALESCE(json_agg(json_build_object('key', key, 'n', n, 'suppliers', rows) ORDER BY n DESC), '[]'::json) FROM by_phone) AS by_phone
                    """,
                    (company_id, company_id),
                )
                row = cur.fetchone() or {}
                return {"by_email": row.get("by_email") or [], "by_phone": row.get("by_phone") or []}
            except pg_errors.UndefinedColumn:
                cur.execute(
                    """
                    WITH by_email AS (
                      SELECT lower(btrim(email)) AS key,
                             COUNT(*)::int AS n,
                             json_agg(json_build_object('id', id, 'code', code, 'name', name, 'email', email, 'phone', phone, 'is_active', is_active) ORDER BY name) AS rows
                      FROM suppliers
                      WHERE company_id=%s AND email IS NOT NULL AND btrim(email) <> ''
                      GROUP BY lower(btrim(email))
                      HAVING COUNT(*) > 1
                    )
                    SELECT COALESCE(json_agg(json_build_object('key', key, 'n', n, 'suppliers', rows) ORDER BY n DESC), '[]'::json) AS by_email
                    FROM by_email
                    """,
                    (company_id,),
                )
                r = cur.fetchone() or {}
                return {"by_email": r.get("by_email") or [], "by_phone": []}


class BulkSupplierIn(BaseModel):
    code: Optional[str] = None
    name: str
    party_type: PartyType = "business"
    legal_name: Optional[str] = None
    tax_id: Optional[str] = None
    vat_no: Optional[str] = None
    notes: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    payment_terms_days: Optional[int] = None
    bank_name: Optional[str] = None
    bank_account_no: Optional[str] = None
    bank_iban: Optional[str] = None
    bank_swift: Optional[str] = None
    payment_instructions: Optional[str] = None
    is_active: Optional[bool] = None


class BulkSuppliersIn(BaseModel):
    suppliers: List[BulkSupplierIn]


@router.post("/bulk", dependencies=[Depends(require_permission("suppliers:write"))])
def bulk_upsert_suppliers(data: BulkSuppliersIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    suppliers = data.suppliers or []
    if not suppliers:
        raise HTTPException(status_code=400, detail="suppliers is required")
    if len(suppliers) > 5000:
        raise HTTPException(status_code=400, detail="too many suppliers (max 5000)")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                upserted = 0
                for s in suppliers:
                    name = (s.name or "").strip()
                    if not name:
                        raise HTTPException(status_code=400, detail="each supplier requires name")
                    code = (s.code or "").strip() or None
                    phone = (s.phone or "").strip() or None
                    email = (s.email or "").strip() or None
                    party_type = s.party_type or "business"
                    legal_name = (s.legal_name or "").strip() or None
                    tax_id = (s.tax_id or "").strip() or None
                    vat_no = (s.vat_no or "").strip() or None
                    notes = (s.notes or "").strip() or None
                    bank_name = (s.bank_name or "").strip() or None
                    bank_account_no = (s.bank_account_no or "").strip() or None
                    bank_iban = (s.bank_iban or "").strip() or None
                    bank_swift = (s.bank_swift or "").strip() or None
                    payment_instructions = (s.payment_instructions or "").strip() or None
                    terms = int(s.payment_terms_days or 0)
                    is_active = bool(s.is_active) if s.is_active is not None else True

                    if code:
                        try:
                            cur.execute(
                                """
                                INSERT INTO suppliers
                                  (id, company_id, code, name, phone, email, payment_terms_days, party_type, legal_name, tax_id, vat_no, notes,
                                   bank_name, bank_account_no, bank_iban, bank_swift, payment_instructions,
                                   is_active)
                                VALUES
                                  (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (company_id, code) WHERE code IS NOT NULL AND code <> '' DO UPDATE
                                SET name = EXCLUDED.name,
                                    phone = EXCLUDED.phone,
                                    email = EXCLUDED.email,
                                    payment_terms_days = EXCLUDED.payment_terms_days,
                                    party_type = EXCLUDED.party_type,
                                    legal_name = EXCLUDED.legal_name,
                                    tax_id = EXCLUDED.tax_id,
                                    vat_no = EXCLUDED.vat_no,
                                    notes = EXCLUDED.notes,
                                    bank_name = EXCLUDED.bank_name,
                                    bank_account_no = EXCLUDED.bank_account_no,
                                    bank_iban = EXCLUDED.bank_iban,
                                    bank_swift = EXCLUDED.bank_swift,
                                    payment_instructions = EXCLUDED.payment_instructions,
                                    is_active = EXCLUDED.is_active
                                RETURNING id
                                """,
                                (
                                    company_id,
                                    code,
                                    name,
                                    phone,
                                    email,
                                    terms,
                                    party_type,
                                    legal_name,
                                    tax_id,
                                    vat_no,
                                    notes,
                                    bank_name,
                                    bank_account_no,
                                    bank_iban,
                                    bank_swift,
                                    payment_instructions,
                                    is_active,
                                ),
                            )
                        except (pg_errors.UndefinedColumn, pg_errors.UndefinedTable, pg_errors.InvalidColumnReference) as e:
                            raise HTTPException(status_code=500, detail=f"db schema mismatch: {e}") from None
                        cur.fetchone()
                        upserted += 1
                        continue

                    existing_id = None
                    if email:
                        cur.execute("SELECT id FROM suppliers WHERE company_id=%s AND lower(email)=lower(%s) LIMIT 1", (company_id, email))
                        r = cur.fetchone()
                        existing_id = r["id"] if r else None

                    if existing_id:
                        cur.execute(
                            """
                            UPDATE suppliers
                            SET name=%s, phone=%s, email=%s, payment_terms_days=%s,
                                party_type=%s, legal_name=%s, tax_id=%s, vat_no=%s, notes=%s,
                                bank_name=%s, bank_account_no=%s, bank_iban=%s, bank_swift=%s, payment_instructions=%s,
                                is_active=%s
                            WHERE company_id=%s AND id=%s
                            """,
                            (
                                name,
                                phone,
                                email,
                                terms,
                                party_type,
                                legal_name,
                                tax_id,
                                vat_no,
                                notes,
                                bank_name,
                                bank_account_no,
                                bank_iban,
                                bank_swift,
                                payment_instructions,
                                is_active,
                                company_id,
                                existing_id,
                            ),
                        )
                        upserted += 1
                    else:
                        cur.execute(
                            """
                            INSERT INTO suppliers
                              (id, company_id, name, phone, email, payment_terms_days, party_type, legal_name, tax_id, vat_no, notes,
                               bank_name, bank_account_no, bank_iban, bank_swift, payment_instructions,
                               is_active)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                company_id,
                                name,
                                phone,
                                email,
                                terms,
                                party_type,
                                legal_name,
                                tax_id,
                                vat_no,
                                notes,
                                bank_name,
                                bank_account_no,
                                bank_iban,
                                bank_swift,
                                payment_instructions,
                                is_active,
                            ),
                        )
                        upserted += 1

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'suppliers_bulk_upsert', 'suppliers', NULL, %s::jsonb)
                    """,
                    (company_id, user["user_id"], json.dumps({"count": upserted})),
                )
                return {"ok": True, "upserted": upserted}


class SupplierContactIn(BaseModel):
    name: str
    title: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    is_primary: bool = False
    is_active: bool = True


class SupplierContactUpdate(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    is_primary: Optional[bool] = None
    is_active: Optional[bool] = None


@router.get("/{supplier_id}/contacts", dependencies=[Depends(require_permission("suppliers:read"))])
def list_supplier_contacts(supplier_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM suppliers WHERE company_id=%s AND id=%s", (company_id, supplier_id))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="supplier not found")
            cur.execute(
                """
                SELECT id, name, title, phone, email, notes, is_primary, is_active, updated_at
                FROM party_contacts
                WHERE company_id = %s AND party_kind = 'supplier' AND party_id = %s
                ORDER BY is_primary DESC, name ASC
                """,
                (company_id, supplier_id),
            )
            return {"contacts": cur.fetchall()}


@router.post("/{supplier_id}/contacts", dependencies=[Depends(require_permission("suppliers:write"))])
def create_supplier_contact(
    supplier_id: str,
    data: SupplierContactIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM suppliers WHERE company_id=%s AND id=%s", (company_id, supplier_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="supplier not found")
                if data.is_primary:
                    cur.execute(
                        """
                        UPDATE party_contacts
                        SET is_primary = false, updated_at = now()
                        WHERE company_id=%s AND party_kind='supplier' AND party_id=%s
                        """,
                        (company_id, supplier_id),
                    )
                cur.execute(
                    """
                    INSERT INTO party_contacts
                      (id, company_id, party_kind, party_id, name, title, phone, email, notes, is_primary, is_active)
                    VALUES
                      (gen_random_uuid(), %s, 'supplier', %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        supplier_id,
                        name,
                        (data.title or "").strip() or None,
                        (data.phone or "").strip() or None,
                        (data.email or "").strip() or None,
                        (data.notes or "").strip() or None,
                        bool(data.is_primary),
                        bool(data.is_active),
                    ),
                )
                cid = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_contact_create', 'party_contact', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], cid, json.dumps({"supplier_id": supplier_id})),
                )
                return {"id": cid}


@router.patch("/{supplier_id}/contacts/{contact_id}", dependencies=[Depends(require_permission("suppliers:write"))])
def update_supplier_contact(
    supplier_id: str,
    contact_id: str,
    data: SupplierContactUpdate,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    patch = data.model_dump(exclude_unset=True)
    if not patch:
        return {"ok": True}
    fields = []
    params = []
    for k, v in patch.items():
        if k in {"name", "title", "phone", "email", "notes"} and isinstance(v, str):
            v = v.strip() or None
        fields.append(f"{k} = %s")
        params.append(v)
    params.extend([company_id, contact_id, supplier_id])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                if patch.get("is_primary") is True:
                    cur.execute(
                        """
                        UPDATE party_contacts
                        SET is_primary = false, updated_at = now()
                        WHERE company_id=%s AND party_kind='supplier' AND party_id=%s
                        """,
                        (company_id, supplier_id),
                    )
                cur.execute(
                    f"""
                    UPDATE party_contacts
                    SET {', '.join(fields)}, updated_at = now()
                    WHERE company_id = %s AND id = %s AND party_kind='supplier' AND party_id=%s
                    RETURNING id
                    """,
                    params,
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="contact not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_contact_update', 'party_contact', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], contact_id, json.dumps({"supplier_id": supplier_id, "patch": patch})),
                )
                return {"ok": True}


@router.delete("/{supplier_id}/contacts/{contact_id}", dependencies=[Depends(require_permission("suppliers:write"))])
def delete_supplier_contact(
    supplier_id: str,
    contact_id: str,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM party_contacts
                    WHERE company_id=%s AND id=%s AND party_kind='supplier' AND party_id=%s
                    """,
                    (company_id, contact_id, supplier_id),
                )
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="contact not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_contact_delete', 'party_contact', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], contact_id, json.dumps({"supplier_id": supplier_id})),
                )
                return {"ok": True}


@router.get("/{supplier_id}/items", dependencies=[Depends(require_permission("suppliers:read"))])
def list_supplier_items(supplier_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.item_id, i.sku, i.name, s.is_primary, s.lead_time_days, s.min_order_qty,
                       s.last_cost_usd, s.last_cost_lbp
                FROM item_suppliers s
                JOIN items i ON i.id = s.item_id
                WHERE s.company_id = %s AND s.supplier_id = %s
                ORDER BY i.sku
                """,
                (company_id, supplier_id),
            )
            return {"items": cur.fetchall()}


@router.post("/{supplier_id}/items", dependencies=[Depends(require_permission("suppliers:write"))])
def add_supplier_item(
    supplier_id: str,
    data: ItemSupplierIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM items WHERE company_id = %s AND id = %s", (company_id, data.item_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="item not found")
                cur.execute("SELECT 1 FROM suppliers WHERE company_id = %s AND id = %s", (company_id, supplier_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="supplier not found")

                cur.execute(
                    """
                    INSERT INTO item_suppliers
                      (id, company_id, item_id, supplier_id, is_primary, lead_time_days, min_order_qty, last_cost_usd, last_cost_lbp)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (company_id, item_id, supplier_id) DO UPDATE
                    SET is_primary = EXCLUDED.is_primary,
                        lead_time_days = EXCLUDED.lead_time_days,
                        min_order_qty = EXCLUDED.min_order_qty,
                        last_cost_usd = EXCLUDED.last_cost_usd,
                        last_cost_lbp = EXCLUDED.last_cost_lbp
                    RETURNING id, item_id, supplier_id, is_primary
                    """,
                    (
                        company_id,
                        data.item_id,
                        supplier_id,
                        data.is_primary,
                        data.lead_time_days,
                        data.min_order_qty,
                        data.last_cost_usd,
                        data.last_cost_lbp,
                    ),
                )
                row = cur.fetchone()

                # If this link is primary, unset other primaries for the same item.
                if row["is_primary"]:
                    cur.execute(
                        """
                        UPDATE item_suppliers
                        SET is_primary = false
                        WHERE company_id = %s AND item_id = %s AND id <> %s
                        """,
                        (company_id, row["item_id"], row["id"]),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_item_upsert', 'item_supplier', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        row["id"],
                        json.dumps(
                            {
                                "item_id": str(row["item_id"]),
                                "supplier_id": str(row["supplier_id"]),
                                "is_primary": bool(row["is_primary"]),
                                "lead_time_days": data.lead_time_days,
                                "min_order_qty": str(data.min_order_qty),
                                "last_cost_usd": str(data.last_cost_usd),
                                "last_cost_lbp": str(data.last_cost_lbp),
                            }
                        ),
                    ),
                )
                return {"id": row["id"]}


class ItemSupplierUpdate(BaseModel):
    is_primary: Optional[bool] = None
    lead_time_days: Optional[int] = None
    min_order_qty: Optional[Decimal] = None
    last_cost_usd: Optional[Decimal] = None
    last_cost_lbp: Optional[Decimal] = None


@router.patch("/item-links/{link_id}", dependencies=[Depends(require_permission("suppliers:write"))])
def update_item_supplier_link(
    link_id: str,
    data: ItemSupplierUpdate,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}
    fields = []
    params = []
    for k, v in patch.items():
        fields.append(f"{k} = %s")
        params.append(v)
    params.extend([company_id, link_id])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE item_suppliers
                    SET {', '.join(fields)}
                    WHERE company_id = %s AND id = %s
                    RETURNING id, item_id, supplier_id, is_primary
                    """,
                    params,
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="link not found")
                if row["is_primary"]:
                    cur.execute(
                        """
                        UPDATE item_suppliers
                        SET is_primary = false
                        WHERE company_id = %s AND item_id = %s AND id <> %s
                        """,
                        (company_id, row["item_id"], row["id"]),
                    )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_item_update', 'item_supplier', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], row["id"], json.dumps(patch)),
                )
                return {"ok": True}


@router.delete("/item-links/{link_id}", dependencies=[Depends(require_permission("suppliers:write"))])
def delete_item_supplier_link(link_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM item_suppliers
                WHERE company_id = %s AND id = %s
                RETURNING id
                """,
                (company_id, link_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="link not found")
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'supplier_item_delete', 'item_supplier', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], link_id, json.dumps({})),
            )
            return {"ok": True}


@router.get("/items/{item_id}", dependencies=[Depends(require_permission("suppliers:read"))])
def list_item_suppliers(item_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.supplier_id, p.name, s.is_primary, s.lead_time_days, s.min_order_qty,
                       s.last_cost_usd, s.last_cost_lbp
                FROM item_suppliers s
                JOIN suppliers p ON p.id = s.supplier_id
                WHERE s.company_id = %s AND s.item_id = %s
                ORDER BY p.name
                """,
                (company_id, item_id),
            )
            return {"suppliers": cur.fetchall()}
