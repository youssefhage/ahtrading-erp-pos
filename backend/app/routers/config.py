from fastapi import APIRouter, Depends
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission
from ..validation import CurrencyCode, PaymentMethod, RateType, TaxType

router = APIRouter(prefix="/config", tags=["config"])


class TaxCodeIn(BaseModel):
    name: str
    rate: Decimal
    tax_type: TaxType = "vat"
    reporting_currency: CurrencyCode = "LBP"


class ExchangeRateIn(BaseModel):
    rate_date: date
    rate_type: RateType
    usd_to_lbp: Decimal


class AccountDefaultIn(BaseModel):
    role_code: str
    account_code: str


class PaymentMethodMappingIn(BaseModel):
    method: PaymentMethod
    role_code: str

@router.get("/account-roles", dependencies=[Depends(require_permission("config:read"))])
def list_account_roles(company_id: str = Depends(get_company_id)):
    # Account roles are global, but we still require an authenticated company context.
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT code, description
                FROM account_roles
                ORDER BY code
                """
            )
            return {"roles": cur.fetchall()}

@router.get("/tax-codes", dependencies=[Depends(require_permission("config:read"))])
def list_tax_codes(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, rate, tax_type, reporting_currency
                FROM tax_codes
                ORDER BY name
                """
            )
            return {"tax_codes": cur.fetchall()}


@router.post("/tax-codes", dependencies=[Depends(require_permission("config:write"))])
def create_tax_code(data: TaxCodeIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tax_codes (id, company_id, name, rate, tax_type, reporting_currency)
                VALUES (gen_random_uuid(), %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (company_id, data.name, data.rate, data.tax_type, data.reporting_currency),
            )
            return {"id": cur.fetchone()["id"]}


@router.get("/exchange-rates", dependencies=[Depends(require_permission("config:read"))])
def list_exchange_rates(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, rate_date, rate_type, usd_to_lbp
                FROM exchange_rates
                ORDER BY rate_date DESC
                """
            )
            return {"rates": cur.fetchall()}


@router.post("/exchange-rates", dependencies=[Depends(require_permission("config:write"))])
def create_exchange_rate(data: ExchangeRateIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO exchange_rates (id, company_id, rate_date, rate_type, usd_to_lbp)
                VALUES (gen_random_uuid(), %s, %s, %s, %s)
                ON CONFLICT (company_id, rate_date, rate_type) DO UPDATE
                SET usd_to_lbp = EXCLUDED.usd_to_lbp
                RETURNING id
                """,
                (company_id, data.rate_date, data.rate_type, data.usd_to_lbp),
            )
            return {"id": cur.fetchone()["id"]}


@router.get("/account-defaults", dependencies=[Depends(require_permission("config:read"))])
def list_account_defaults(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.role_code, a.account_code, a.name_en
                FROM company_account_defaults d
                JOIN company_coa_accounts a ON a.id = d.account_id
                WHERE d.company_id = %s
                ORDER BY d.role_code
                """,
                (company_id,),
            )
            return {"defaults": cur.fetchall()}


@router.post("/account-defaults", dependencies=[Depends(require_permission("config:write"))])
def set_account_default(data: AccountDefaultIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM company_coa_accounts
                WHERE company_id = %s AND account_code = %s
                """,
                (company_id, data.account_code),
            )
            acc = cur.fetchone()
            if not acc:
                return {"error": "account_code not found"}
            cur.execute(
                """
                INSERT INTO company_account_defaults (company_id, role_code, account_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (company_id, role_code) DO UPDATE SET account_id = EXCLUDED.account_id
                """,
                (company_id, data.role_code, acc["id"]),
            )
            return {"ok": True}


@router.get("/payment-methods", dependencies=[Depends(require_permission("config:read"))])
def list_payment_methods(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT method, role_code, created_at
                FROM payment_method_mappings
                WHERE company_id = %s
                ORDER BY method
                """,
                (company_id,),
            )
            return {"methods": cur.fetchall()}


@router.post("/payment-methods", dependencies=[Depends(require_permission("config:write"))])
def upsert_payment_method(data: PaymentMethodMappingIn, company_id: str = Depends(get_company_id)):
    method = (data.method or "").strip().lower()
    if not method:
        return {"error": "method is required"}
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT code FROM account_roles WHERE code = %s",
                (data.role_code,),
            )
            if not cur.fetchone():
                return {"error": "invalid role_code"}
            cur.execute(
                """
                INSERT INTO payment_method_mappings (company_id, method, role_code)
                VALUES (%s, %s, %s)
                ON CONFLICT (company_id, method) DO UPDATE
                SET role_code = EXCLUDED.role_code
                """,
                (company_id, method, data.role_code),
            )
            return {"ok": True}
