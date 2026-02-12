from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
from ..validation import CurrencyCode, PaymentMethod, RateType, TaxType
import json

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


@router.get("/preflight", dependencies=[Depends(require_permission("config:read"))])
def preflight(company_id: str = Depends(get_company_id)):
    """
    Lightweight go-live readiness checks. This is not a guarantee, but it catches
    the most common "go-live day" blockers (missing defaults, missing warehouse, etc).
    """
    checks: list[dict] = []

    def add(name: str, status: str, detail: str):
        checks.append({"name": name, "status": status, "detail": detail})

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute("SELECT name, base_currency, vat_currency, default_rate_type FROM companies WHERE id=%s", (company_id,))
            c = cur.fetchone()
            if c:
                add("company", "ok", f"{c['name']} ({c['base_currency']}/{c['vat_currency']}, rate={c['default_rate_type']})")
            else:
                add("company", "error", "Company not found")

            cur.execute("SELECT COUNT(*)::int AS n FROM warehouses WHERE company_id=%s", (company_id,))
            n_wh = int(cur.fetchone()["n"])
            add("warehouses", "ok" if n_wh > 0 else "error", f"{n_wh} warehouse(s)")

            cur.execute("SELECT COUNT(*)::int AS n FROM branches WHERE company_id=%s", (company_id,))
            n_br = int(cur.fetchone()["n"])
            add("branches", "ok" if n_br > 0 else "warn", f"{n_br} branch(es)")

            cur.execute("SELECT COUNT(*)::int AS n FROM tax_codes WHERE company_id=%s", (company_id,))
            n_tax = int(cur.fetchone()["n"])
            add("tax_codes", "ok" if n_tax > 0 else "warn", f"{n_tax} tax code(s)")

            cur.execute(
                """
                SELECT COUNT(*)::int AS n
                FROM exchange_rates
                WHERE company_id=%s AND rate_date = CURRENT_DATE
                """,
                (company_id,),
            )
            n_rates_today = int(cur.fetchone()["n"])
            add("exchange_rate_today", "ok" if n_rates_today > 0 else "warn", f"{n_rates_today} rate(s) for today")

            # Account defaults are mandatory for posting documents.
            required_defaults = [
                "AR",
                "AP",
                "CASH",
                "BANK",
                "SALES",
                "SALES_RETURNS",
                "INVENTORY",
                "COGS",
                "VAT_PAYABLE",
                "VAT_RECOVERABLE",
                "OPENING_BALANCE",
                "INV_ADJ",
            ]
            cur.execute(
                "SELECT role_code FROM company_account_defaults WHERE company_id=%s",
                (company_id,),
            )
            have = {str(r["role_code"]) for r in cur.fetchall()}
            missing = [r for r in required_defaults if r not in have]
            add(
                "account_defaults",
                "ok" if not missing else "error",
                "all required defaults present" if not missing else f"missing: {', '.join(missing)}",
            )

            cur.execute("SELECT COUNT(*)::int AS n FROM payment_method_mappings WHERE company_id=%s", (company_id,))
            n_pm = int(cur.fetchone()["n"])
            add("payment_methods", "ok" if n_pm > 0 else "warn", f"{n_pm} mapping(s)")

            cur.execute("SELECT COUNT(*)::int AS n FROM pos_devices WHERE company_id=%s", (company_id,))
            n_dev = int(cur.fetchone()["n"])
            add("pos_devices", "ok" if n_dev > 0 else "warn", f"{n_dev} device(s)")

    ok = all(c["status"] != "error" for c in checks)
    return {"ok": ok, "checks": checks}

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
                SELECT t.id,
                       t.name,
                       t.rate,
                       t.tax_type,
                       t.reporting_currency,
                       COALESCE(i.n, 0) AS item_refs,
                       COALESCE(l.n, 0) AS tax_line_refs
                FROM tax_codes t
                LEFT JOIN (
                    SELECT tax_code_id, COUNT(*)::int AS n
                    FROM items
                    WHERE company_id = %s AND tax_code_id IS NOT NULL
                    GROUP BY tax_code_id
                ) i ON i.tax_code_id = t.id
                LEFT JOIN (
                    SELECT tax_code_id, COUNT(*)::int AS n
                    FROM tax_lines
                    WHERE company_id = %s
                    GROUP BY tax_code_id
                ) l ON l.tax_code_id = t.id
                WHERE t.company_id = %s
                ORDER BY t.name
                """
                ,
                (company_id, company_id, company_id),
            )
            return {"tax_codes": cur.fetchall()}


@router.post("/tax-codes", dependencies=[Depends(require_permission("config:write"))])
def create_tax_code(data: TaxCodeIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
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
            tid = cur.fetchone()["id"]
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'config.tax_code.create', 'tax_code', %s, %s::jsonb)
                """,
                (
                    company_id,
                    user["user_id"],
                    tid,
                    json.dumps(
                        {
                            "name": data.name,
                            "rate": str(data.rate),
                            "tax_type": data.tax_type,
                            "reporting_currency": data.reporting_currency,
                        }
                    ),
                ),
            )
            return {"id": tid}


@router.patch("/tax-codes/{tax_code_id}", dependencies=[Depends(require_permission("config:write"))])
def update_tax_code(
    tax_code_id: str,
    data: TaxCodeIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, rate, tax_type, reporting_currency
                FROM tax_codes
                WHERE company_id = %s AND id = %s
                """,
                (company_id, tax_code_id),
            )
            before = cur.fetchone()
            if not before:
                raise HTTPException(status_code=404, detail="tax code not found")

            cur.execute(
                """
                UPDATE tax_codes
                SET name = %s,
                    rate = %s,
                    tax_type = %s,
                    reporting_currency = %s
                WHERE company_id = %s AND id = %s
                RETURNING id
                """,
                (
                    data.name,
                    data.rate,
                    data.tax_type,
                    data.reporting_currency,
                    company_id,
                    tax_code_id,
                ),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="tax code not found")

            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'config.tax_code.update', 'tax_code', %s, %s::jsonb)
                """,
                (
                    company_id,
                    user["user_id"],
                    tax_code_id,
                    json.dumps(
                        {
                            "before": {
                                "name": before["name"],
                                "rate": str(before["rate"]),
                                "tax_type": before["tax_type"],
                                "reporting_currency": before["reporting_currency"],
                            },
                            "after": {
                                "name": data.name,
                                "rate": str(data.rate),
                                "tax_type": data.tax_type,
                                "reporting_currency": data.reporting_currency,
                            },
                        }
                    ),
                ),
            )
            return {"id": row["id"]}


@router.delete("/tax-codes/{tax_code_id}", dependencies=[Depends(require_permission("config:write"))])
def delete_tax_code(
    tax_code_id: str,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, rate, tax_type, reporting_currency
                FROM tax_codes
                WHERE company_id = %s AND id = %s
                """,
                (company_id, tax_code_id),
            )
            before = cur.fetchone()
            if not before:
                raise HTTPException(status_code=404, detail="tax code not found")

            ref_checks = [
                ("items", "SELECT COUNT(*)::int AS n FROM items WHERE company_id=%s AND tax_code_id=%s"),
                ("tax_lines", "SELECT COUNT(*)::int AS n FROM tax_lines WHERE company_id=%s AND tax_code_id=%s"),
            ]

            cur.execute(
                """
                SELECT EXISTS(
                  SELECT 1
                  FROM information_schema.columns
                  WHERE table_schema='public'
                    AND table_name='supplier_invoices'
                    AND column_name='tax_code_id'
                ) AS ok
                """
            )
            has_supplier_invoice_tax = bool((cur.fetchone() or {}).get("ok"))
            if has_supplier_invoice_tax:
                ref_checks.append(
                    ("supplier_invoices", "SELECT COUNT(*)::int AS n FROM supplier_invoices WHERE company_id=%s AND tax_code_id=%s")
                )

            in_use: list[str] = []
            for label, sql in ref_checks:
                cur.execute(sql, (company_id, tax_code_id))
                n = int((cur.fetchone() or {}).get("n") or 0)
                if n > 0:
                    in_use.append(f"{label}:{n}")

            if in_use:
                raise HTTPException(
                    status_code=409,
                    detail=f"tax code is in use ({', '.join(in_use)}); reassign dependent records first",
                )

            cur.execute(
                """
                DELETE FROM tax_codes
                WHERE company_id = %s AND id = %s
                RETURNING id
                """,
                (company_id, tax_code_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="tax code not found")

            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'config.tax_code.delete', 'tax_code', %s, %s::jsonb)
                """,
                (
                    company_id,
                    user["user_id"],
                    tax_code_id,
                    json.dumps(
                        {
                            "name": before["name"],
                            "rate": str(before["rate"]),
                            "tax_type": before["tax_type"],
                            "reporting_currency": before["reporting_currency"],
                        }
                    ),
                ),
            )
            return {"id": row["id"]}


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
def create_exchange_rate(data: ExchangeRateIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
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
            rid = cur.fetchone()["id"]
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'config.exchange_rate.upsert', 'exchange_rate', %s, %s::jsonb)
                """,
                (
                    company_id,
                    user["user_id"],
                    rid,
                    json.dumps({"rate_date": str(data.rate_date), "rate_type": data.rate_type, "usd_to_lbp": str(data.usd_to_lbp)}),
                ),
            )
            return {"id": rid}


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
def set_account_default(data: AccountDefaultIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
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
                raise HTTPException(status_code=400, detail="account_code not found")
            cur.execute(
                """
                INSERT INTO company_account_defaults (company_id, role_code, account_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (company_id, role_code) DO UPDATE SET account_id = EXCLUDED.account_id
                """,
                (company_id, data.role_code, acc["id"]),
            )
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'config.account_default.set', 'company', %s, %s::jsonb)
                """,
                (
                    company_id,
                    user["user_id"],
                    company_id,
                    json.dumps({"role_code": data.role_code, "account_code": data.account_code}),
                ),
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
def upsert_payment_method(data: PaymentMethodMappingIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    method = (data.method or "").strip().lower()
    if not method:
        raise HTTPException(status_code=400, detail="method is required")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT code FROM account_roles WHERE code = %s",
                (data.role_code,),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=400, detail="invalid role_code")
            cur.execute(
                """
                INSERT INTO payment_method_mappings (company_id, method, role_code)
                VALUES (%s, %s, %s)
                ON CONFLICT (company_id, method) DO UPDATE
                SET role_code = EXCLUDED.role_code
                """,
                (company_id, method, data.role_code),
            )
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'config.payment_method.upsert', 'company', %s, %s::jsonb)
                """,
                (
                    company_id,
                    user["user_id"],
                    company_id,
                    json.dumps({"method": method, "role_code": data.role_code}),
                ),
            )
            return {"ok": True}


@router.get("/worker-heartbeats", dependencies=[Depends(require_permission("config:read"))])
def worker_heartbeats(company_id: str = Depends(get_company_id)):
    """
    Ops endpoint: surface per-company worker liveness for the Admin UI.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT worker_name, last_seen_at, details
                FROM worker_heartbeats
                WHERE company_id = %s
                ORDER BY worker_name
                """,
                (company_id,),
            )
            return {"heartbeats": cur.fetchall()}
