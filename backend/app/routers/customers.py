import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Literal, List
from datetime import date
from psycopg import errors as pg_errors
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user

router = APIRouter(prefix="/customers", tags=["customers"])

PartyType = Literal["individual", "business"]
CustomerType = Literal["retail", "wholesale", "b2b"]


class CustomerIn(BaseModel):
    code: Optional[str] = None
    name: str
    party_type: PartyType = "individual"  # individual|business
    customer_type: CustomerType = "retail"
    assigned_salesperson_user_id: Optional[str] = None
    marketing_opt_in: bool = False
    legal_name: Optional[str] = None
    tax_id: Optional[str] = None
    vat_no: Optional[str] = None
    notes: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    membership_no: Optional[str] = None
    is_member: Optional[bool] = None
    membership_expires_at: Optional[date] = None
    payment_terms_days: Optional[int] = None
    credit_limit_usd: Optional[float] = None
    credit_limit_lbp: Optional[float] = None
    price_list_id: Optional[str] = None
    is_active: Optional[bool] = None


class BulkCustomerIn(BaseModel):
    code: str
    name: str
    party_type: PartyType = "individual"
    customer_type: CustomerType = "retail"
    phone: Optional[str] = None
    email: Optional[str] = None
    tax_id: Optional[str] = None
    vat_no: Optional[str] = None
    payment_terms_days: Optional[int] = None
    is_active: Optional[bool] = None


class BulkCustomersIn(BaseModel):
    customers: List[BulkCustomerIn]


@router.get("", dependencies=[Depends(require_permission("customers:read"))])
def list_customers(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, name, phone, email, party_type, customer_type, assigned_salesperson_user_id, marketing_opt_in,
                       legal_name, tax_id, vat_no, notes,
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
                (company_id,),
            )
            return {"customers": cur.fetchall()}


@router.post("/bulk", dependencies=[Depends(require_permission("customers:write"))])
def bulk_upsert_customers(data: BulkCustomersIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Go-live utility: upsert customers by (company_id, code).
    """
    customers = data.customers or []
    if not customers:
        raise HTTPException(status_code=400, detail="customers is required")
    if len(customers) > 10000:
        raise HTTPException(status_code=400, detail="too many customers (max 10000)")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                upserted = 0
                for c in customers:
                    code = (c.code or "").strip()
                    name = (c.name or "").strip()
                    if not code or not name:
                        raise HTTPException(status_code=400, detail="each customer requires code and name")
                    cur.execute(
                        """
                        INSERT INTO customers (id, company_id, code, name, phone, email, party_type, customer_type,
                                               tax_id, vat_no, payment_terms_days, is_active)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (company_id, code) DO UPDATE
                        SET name = EXCLUDED.name,
                            phone = EXCLUDED.phone,
                            email = EXCLUDED.email,
                            party_type = EXCLUDED.party_type,
                            customer_type = EXCLUDED.customer_type,
                            tax_id = EXCLUDED.tax_id,
                            vat_no = EXCLUDED.vat_no,
                            payment_terms_days = EXCLUDED.payment_terms_days,
                            is_active = EXCLUDED.is_active,
                            updated_at = now()
                        """,
                        (
                            company_id,
                            code,
                            name,
                            (c.phone or "").strip() or None,
                            (c.email or "").strip() or None,
                            c.party_type,
                            c.customer_type,
                            (c.tax_id or "").strip() or None,
                            (c.vat_no or "").strip() or None,
                            int(c.payment_terms_days or 0),
                            bool(c.is_active) if c.is_active is not None else True,
                        ),
                    )
                    upserted += 1

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'customers_bulk_upsert', 'customers', NULL, %s::jsonb)
                    """,
                    (company_id, user["user_id"], json.dumps({"count": upserted})),
                )
                return {"ok": True, "upserted": upserted}


@router.get("/typeahead", dependencies=[Depends(require_permission("customers:read"))])
def customers_typeahead(
    q: str = "",
    limit: int = 50,
    include_inactive: bool = False,
    company_id: str = Depends(get_company_id),
):
    """
    Scalable customer picker endpoint for Admin UI.
    Searches name/code/phone/email/membership_no. Defaults to active-only.
    """
    q = (q or "").strip()
    limit = int(limit or 0)
    if limit <= 0:
        limit = 50
    limit = min(limit, 200)
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            like = f"%{q}%"
            cur.execute(
                """
                SELECT id, code, name, phone, email, membership_no, payment_terms_days, price_list_id, is_active, updated_at
                FROM customers
                WHERE company_id=%s
                  AND (%s OR is_active=true)
                  AND (
                    %s = ''
                    OR name ILIKE %s
                    OR code ILIKE %s
                    OR phone ILIKE %s
                    OR email ILIKE %s
                    OR membership_no ILIKE %s
                  )
                ORDER BY is_active DESC, name ASC
                LIMIT %s
                """,
                (
                    company_id,
                    bool(include_inactive),
                    q,
                    like,
                    like,
                    like,
                    like,
                    like,
                    limit,
                ),
            )
            return {"customers": cur.fetchall()}


@router.get("/{customer_id}", dependencies=[Depends(require_permission("customers:read"))])
def get_customer(customer_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, name, phone, email, party_type, customer_type, assigned_salesperson_user_id, marketing_opt_in,
                       legal_name, tax_id, vat_no, notes,
                       membership_no, is_member, membership_expires_at,
                       payment_terms_days,
                       credit_limit_usd, credit_limit_lbp,
                       credit_balance_usd, credit_balance_lbp,
                       loyalty_points,
                       price_list_id,
                       is_active,
                       updated_at
                FROM customers
                WHERE company_id=%s AND id=%s
                """,
                (company_id, customer_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Customer not found")
            return {"customer": row}


@router.post("", dependencies=[Depends(require_permission("customers:write"))])
def create_customer(data: CustomerIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            code = (data.code or "").strip() or None
            cur.execute(
                """
                INSERT INTO customers
                  (id, company_id, code, name, phone, email, party_type, customer_type, assigned_salesperson_user_id, marketing_opt_in,
                   legal_name, tax_id, vat_no, notes,
                   membership_no, is_member, membership_expires_at,
                   payment_terms_days, credit_limit_usd, credit_limit_lbp,
                   price_list_id, is_active)
                VALUES
                  (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    company_id,
                    code,
                    data.name,
                    data.phone,
                    data.email,
                    data.party_type,
                    data.customer_type,
                    data.assigned_salesperson_user_id,
                    bool(data.marketing_opt_in),
                    (data.legal_name or "").strip() or None,
                    (data.tax_id or "").strip() or None,
                    (data.vat_no or "").strip() or None,
                    (data.notes or "").strip() or None,
                    (data.membership_no or "").strip() or None,
                    bool(data.is_member) if data.is_member is not None else False,
                    data.membership_expires_at,
                    data.payment_terms_days or 0,
                    data.credit_limit_usd or 0,
                    data.credit_limit_lbp or 0,
                    data.price_list_id,
                    bool(data.is_active) if data.is_active is not None else True,
                ),
            )
            return {"id": cur.fetchone()["id"]}


class CustomerUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    party_type: Optional[PartyType] = None
    customer_type: Optional[CustomerType] = None
    assigned_salesperson_user_id: Optional[str] = None
    marketing_opt_in: Optional[bool] = None
    legal_name: Optional[str] = None
    tax_id: Optional[str] = None
    vat_no: Optional[str] = None
    notes: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    membership_no: Optional[str] = None
    is_member: Optional[bool] = None
    membership_expires_at: Optional[date] = None
    payment_terms_days: Optional[int] = None
    credit_limit_usd: Optional[float] = None
    credit_limit_lbp: Optional[float] = None
    price_list_id: Optional[str] = None
    is_active: Optional[bool] = None


@router.patch("/{customer_id}", dependencies=[Depends(require_permission("customers:write"))])
def update_customer(customer_id: str, data: CustomerUpdate, company_id: str = Depends(get_company_id)):
    fields = []
    params = []
    payload = data.model_dump(exclude_none=True)
    if "membership_no" in payload:
        payload["membership_no"] = (payload.get("membership_no") or "").strip() or None
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
    for k, v in payload.items():
        fields.append(f"{k} = %s")
        params.append(v)
    if not fields:
        return {"ok": True}
    params.extend([company_id, customer_id])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE customers
                SET {', '.join(fields)}
                WHERE company_id = %s AND id = %s
                """,
                params,
            )
            return {"ok": True}


class BulkCustomerIn(BaseModel):
    code: Optional[str] = None
    name: str
    party_type: PartyType = "individual"
    customer_type: CustomerType = "retail"
    assigned_salesperson_user_id: Optional[str] = None
    marketing_opt_in: bool = False
    legal_name: Optional[str] = None
    tax_id: Optional[str] = None
    vat_no: Optional[str] = None
    notes: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    membership_no: Optional[str] = None
    is_member: Optional[bool] = None
    membership_expires_at: Optional[date] = None
    payment_terms_days: Optional[int] = None
    credit_limit_usd: Optional[float] = None
    credit_limit_lbp: Optional[float] = None
    price_list_id: Optional[str] = None
    is_active: Optional[bool] = None


class BulkCustomersIn(BaseModel):
    customers: List[BulkCustomerIn]


@router.post("/bulk", dependencies=[Depends(require_permission("customers:write"))])
def bulk_upsert_customers(data: BulkCustomersIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    customers = data.customers or []
    if not customers:
        raise HTTPException(status_code=400, detail="customers is required")
    if len(customers) > 5000:
        raise HTTPException(status_code=400, detail="too many customers (max 5000)")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                upserted = 0
                for c in customers:
                    name = (c.name or "").strip()
                    if not name:
                        raise HTTPException(status_code=400, detail="each customer requires name")
                    code = (c.code or "").strip() or None
                    membership_no = (c.membership_no or "").strip() or None
                    phone = (c.phone or "").strip() or None
                    email = (c.email or "").strip() or None
                    party_type = c.party_type or "individual"

                    payload = {
                        "code": code,
                        "name": name,
                        "phone": phone,
                        "email": email,
                        "party_type": party_type,
                        "customer_type": c.customer_type or "retail",
                        "assigned_salesperson_user_id": c.assigned_salesperson_user_id,
                        "marketing_opt_in": bool(c.marketing_opt_in),
                        "legal_name": (c.legal_name or "").strip() or None,
                        "tax_id": (c.tax_id or "").strip() or None,
                        "vat_no": (c.vat_no or "").strip() or None,
                        "notes": (c.notes or "").strip() or None,
                        "membership_no": membership_no,
                        "is_member": bool(c.is_member) if c.is_member is not None else False,
                        "membership_expires_at": c.membership_expires_at,
                        "payment_terms_days": int(c.payment_terms_days or 0),
                        "credit_limit_usd": float(c.credit_limit_usd or 0),
                        "credit_limit_lbp": float(c.credit_limit_lbp or 0),
                        "price_list_id": c.price_list_id,
                        "is_active": bool(c.is_active) if c.is_active is not None else True,
                    }

                    if code:
                        try:
                            cur.execute(
                                """
                                INSERT INTO customers
                                  (id, company_id, code, name, phone, email, party_type, customer_type, assigned_salesperson_user_id, marketing_opt_in,
                                   legal_name, tax_id, vat_no, notes,
                                   membership_no, is_member, membership_expires_at,
                                   payment_terms_days, credit_limit_usd, credit_limit_lbp, price_list_id, is_active)
                                VALUES
                                  (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (company_id, code) WHERE code IS NOT NULL AND code <> '' DO UPDATE
                                SET name = EXCLUDED.name,
                                    phone = EXCLUDED.phone,
                                    email = EXCLUDED.email,
                                    party_type = EXCLUDED.party_type,
                                    customer_type = EXCLUDED.customer_type,
                                    assigned_salesperson_user_id = EXCLUDED.assigned_salesperson_user_id,
                                    marketing_opt_in = EXCLUDED.marketing_opt_in,
                                    legal_name = EXCLUDED.legal_name,
                                    tax_id = EXCLUDED.tax_id,
                                    vat_no = EXCLUDED.vat_no,
                                    notes = EXCLUDED.notes,
                                    membership_no = EXCLUDED.membership_no,
                                    is_member = EXCLUDED.is_member,
                                    membership_expires_at = EXCLUDED.membership_expires_at,
                                    payment_terms_days = EXCLUDED.payment_terms_days,
                                    credit_limit_usd = EXCLUDED.credit_limit_usd,
                                    credit_limit_lbp = EXCLUDED.credit_limit_lbp,
                                    price_list_id = EXCLUDED.price_list_id,
                                    is_active = EXCLUDED.is_active
                                RETURNING id
                                """,
                                (
                                    company_id,
                                    payload["code"],
                                    payload["name"],
                                    payload["phone"],
                                    payload["email"],
                                    payload["party_type"],
                                    payload["customer_type"],
                                    payload["assigned_salesperson_user_id"],
                                    payload["marketing_opt_in"],
                                    payload["legal_name"],
                                    payload["tax_id"],
                                    payload["vat_no"],
                                    payload["notes"],
                                    payload["membership_no"],
                                    payload["is_member"],
                                    payload["membership_expires_at"],
                                    payload["payment_terms_days"],
                                    payload["credit_limit_usd"],
                                    payload["credit_limit_lbp"],
                                    payload["price_list_id"],
                                    payload["is_active"],
                                ),
                            )
                        except (pg_errors.UndefinedColumn, pg_errors.UndefinedTable, pg_errors.InvalidColumnReference) as e:
                            # Help diagnose schema drift during pilots without requiring DB shell access.
                            raise HTTPException(status_code=500, detail=f"db schema mismatch: {e}") from None
                        cur.fetchone()
                        upserted += 1
                        continue

                    existing_id = None
                    if membership_no:
                        cur.execute("SELECT id FROM customers WHERE company_id=%s AND membership_no=%s LIMIT 1", (company_id, membership_no))
                        r = cur.fetchone()
                        existing_id = r["id"] if r else None
                    elif email:
                        cur.execute("SELECT id FROM customers WHERE company_id=%s AND lower(email)=lower(%s) LIMIT 1", (company_id, email))
                        r = cur.fetchone()
                        existing_id = r["id"] if r else None

                    if existing_id:
                        cur.execute(
                            """
                            UPDATE customers
                            SET name=%s,
                                phone=%s,
                                email=%s,
                                party_type=%s,
                                customer_type=%s,
                                assigned_salesperson_user_id=%s,
                                marketing_opt_in=%s,
                                legal_name=%s,
                                tax_id=%s,
                                vat_no=%s,
                                notes=%s,
                                membership_no=%s,
                                is_member=%s,
                                membership_expires_at=%s,
                                payment_terms_days=%s,
                                credit_limit_usd=%s,
                                credit_limit_lbp=%s,
                                price_list_id=%s
                            WHERE company_id=%s AND id=%s
                            """,
                            (
                                payload["name"],
                                payload["phone"],
                                payload["email"],
                                payload["party_type"],
                                payload["customer_type"],
                                payload["assigned_salesperson_user_id"],
                                payload["marketing_opt_in"],
                                payload["legal_name"],
                                payload["tax_id"],
                                payload["vat_no"],
                                payload["notes"],
                                payload["membership_no"],
                                payload["is_member"],
                                payload["membership_expires_at"],
                                payload["payment_terms_days"],
                                payload["credit_limit_usd"],
                                payload["credit_limit_lbp"],
                                payload["price_list_id"],
                                company_id,
                                existing_id,
                            ),
                        )
                        upserted += 1
                    else:
                        cur.execute(
                            """
                            INSERT INTO customers
                              (id, company_id, name, phone, email, party_type, customer_type, assigned_salesperson_user_id, marketing_opt_in,
                               legal_name, tax_id, vat_no, notes,
                               membership_no, is_member, membership_expires_at,
                               payment_terms_days, credit_limit_usd, credit_limit_lbp, price_list_id)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                company_id,
                                payload["name"],
                                payload["phone"],
                                payload["email"],
                                payload["party_type"],
                                payload["customer_type"],
                                payload["assigned_salesperson_user_id"],
                                payload["marketing_opt_in"],
                                payload["legal_name"],
                                payload["tax_id"],
                                payload["vat_no"],
                                payload["notes"],
                                payload["membership_no"],
                                payload["is_member"],
                                payload["membership_expires_at"],
                                payload["payment_terms_days"],
                                payload["credit_limit_usd"],
                                payload["credit_limit_lbp"],
                                payload["price_list_id"],
                            ),
                        )
                        upserted += 1

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'customers_bulk_upsert', 'customers', NULL, %s::jsonb)
                    """,
                    (company_id, user["user_id"], json.dumps({"count": upserted})),
                )
                return {"ok": True, "upserted": upserted}


class CustomerContactIn(BaseModel):
    name: str
    title: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    is_primary: bool = False
    is_active: bool = True


class CustomerContactUpdate(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    is_primary: Optional[bool] = None
    is_active: Optional[bool] = None


@router.get("/{customer_id}/contacts", dependencies=[Depends(require_permission("customers:read"))])
def list_customer_contacts(customer_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM customers WHERE company_id=%s AND id=%s", (company_id, customer_id))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="customer not found")
            cur.execute(
                """
                SELECT id, name, title, phone, email, notes, is_primary, is_active, updated_at
                FROM party_contacts
                WHERE company_id = %s AND party_kind = 'customer' AND party_id = %s
                ORDER BY is_primary DESC, name ASC
                """,
                (company_id, customer_id),
            )
            return {"contacts": cur.fetchall()}


@router.post("/{customer_id}/contacts", dependencies=[Depends(require_permission("customers:write"))])
def create_customer_contact(
    customer_id: str,
    data: CustomerContactIn,
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
                cur.execute("SELECT 1 FROM customers WHERE company_id=%s AND id=%s", (company_id, customer_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="customer not found")
                if data.is_primary:
                    cur.execute(
                        """
                        UPDATE party_contacts
                        SET is_primary = false, updated_at = now()
                        WHERE company_id=%s AND party_kind='customer' AND party_id=%s
                        """,
                        (company_id, customer_id),
                    )
                cur.execute(
                    """
                    INSERT INTO party_contacts
                      (id, company_id, party_kind, party_id, name, title, phone, email, notes, is_primary, is_active)
                    VALUES
                      (gen_random_uuid(), %s, 'customer', %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        customer_id,
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
                    VALUES (gen_random_uuid(), %s, %s, 'customer_contact_create', 'party_contact', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], cid, json.dumps({"customer_id": customer_id})),
                )
                return {"id": cid}


@router.patch("/{customer_id}/contacts/{contact_id}", dependencies=[Depends(require_permission("customers:write"))])
def update_customer_contact(
    customer_id: str,
    contact_id: str,
    data: CustomerContactUpdate,
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
    params.extend([company_id, contact_id, customer_id])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                if patch.get("is_primary") is True:
                    cur.execute(
                        """
                        UPDATE party_contacts
                        SET is_primary = false, updated_at = now()
                        WHERE company_id=%s AND party_kind='customer' AND party_id=%s
                        """,
                        (company_id, customer_id),
                    )
                cur.execute(
                    f"""
                    UPDATE party_contacts
                    SET {', '.join(fields)}, updated_at = now()
                    WHERE company_id = %s AND id = %s AND party_kind='customer' AND party_id=%s
                    RETURNING id
                    """,
                    params,
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="contact not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'customer_contact_update', 'party_contact', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], contact_id, json.dumps({"customer_id": customer_id, "patch": patch})),
                )
                return {"ok": True}


@router.delete("/{customer_id}/contacts/{contact_id}", dependencies=[Depends(require_permission("customers:write"))])
def delete_customer_contact(
    customer_id: str,
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
                    WHERE company_id=%s AND id=%s AND party_kind='customer' AND party_id=%s
                    """,
                    (company_id, contact_id, customer_id),
                )
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="contact not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'customer_contact_delete', 'party_contact', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], contact_id, json.dumps({"customer_id": customer_id})),
                )
                return {"ok": True}


@router.get("/{customer_id}/loyalty-ledger", dependencies=[Depends(require_permission("customers:read"))])
def loyalty_ledger(customer_id: str, limit: int = 100, company_id: str = Depends(get_company_id)):
    if limit <= 0 or limit > 500:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 500")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT loyalty_points
                FROM customers
                WHERE company_id=%s AND id=%s
                """,
                (company_id, customer_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="customer not found")

            cur.execute(
                """
                SELECT id, source_type, source_id, points, created_at
                FROM customer_loyalty_ledger
                WHERE company_id=%s AND customer_id=%s
                ORDER BY created_at DESC, id DESC
                LIMIT %s
                """,
                (company_id, customer_id, limit),
            )
            return {"customer_id": customer_id, "loyalty_points": row["loyalty_points"], "ledger": cur.fetchall()}
