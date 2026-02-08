import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Literal, List
from datetime import date
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user

router = APIRouter(prefix="/customers", tags=["customers"])

PartyType = Literal["individual", "business"]


class CustomerIn(BaseModel):
    code: Optional[str] = None
    name: str
    party_type: PartyType = "individual"  # individual|business
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


@router.get("", dependencies=[Depends(require_permission("customers:read"))])
def list_customers(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, name, phone, email, party_type, legal_name, tax_id, vat_no, notes,
                       membership_no, is_member, membership_expires_at,
                       payment_terms_days,
                       credit_limit_usd, credit_limit_lbp,
                       credit_balance_usd, credit_balance_lbp,
                       loyalty_points,
                       price_list_id,
                       updated_at
                FROM customers
                WHERE company_id = %s
                ORDER BY name
                """,
                (company_id,),
            )
            return {"customers": cur.fetchall()}


@router.post("", dependencies=[Depends(require_permission("customers:write"))])
def create_customer(data: CustomerIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            code = (data.code or "").strip() or None
            cur.execute(
                """
                INSERT INTO customers
                  (id, company_id, code, name, phone, email, party_type, legal_name, tax_id, vat_no, notes,
                   membership_no, is_member, membership_expires_at,
                   payment_terms_days, credit_limit_usd, credit_limit_lbp,
                   price_list_id)
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
                    data.party_type,
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
                ),
            )
            return {"id": cur.fetchone()["id"]}


class CustomerUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    party_type: Optional[PartyType] = None
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


@router.patch("/{customer_id}", dependencies=[Depends(require_permission("customers:write"))])
def update_customer(customer_id: str, data: CustomerUpdate, company_id: str = Depends(get_company_id)):
    fields = []
    params = []
    payload = data.model_dump(exclude_none=True)
    if "membership_no" in payload:
        payload["membership_no"] = (payload.get("membership_no") or "").strip() or None
    if "code" in payload:
        payload["code"] = (payload.get("code") or "").strip() or None
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
                    }

                    if code:
                        cur.execute(
                            """
                            INSERT INTO customers
                              (id, company_id, code, name, phone, email, party_type, legal_name, tax_id, vat_no, notes,
                               membership_no, is_member, membership_expires_at,
                               payment_terms_days, credit_limit_usd, credit_limit_lbp, price_list_id)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (company_id, code) DO UPDATE
                            SET name = EXCLUDED.name,
                                phone = EXCLUDED.phone,
                                email = EXCLUDED.email,
                                party_type = EXCLUDED.party_type,
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
                                price_list_id = EXCLUDED.price_list_id
                            RETURNING id
                            """,
                            (
                                company_id,
                                payload["code"],
                                payload["name"],
                                payload["phone"],
                                payload["email"],
                                payload["party_type"],
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
                              (id, company_id, name, phone, email, party_type, legal_name, tax_id, vat_no, notes,
                               membership_no, is_member, membership_expires_at,
                               payment_terms_days, credit_limit_usd, credit_limit_lbp, price_list_id)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                company_id,
                                payload["name"],
                                payload["phone"],
                                payload["email"],
                                payload["party_type"],
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
