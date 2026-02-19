from __future__ import annotations

from typing import Iterable, Optional

AUTO_HEAL_ROLES = (
    "AR",
    "AP",
    "CASH",
    "BANK",
    "SALES",
    "SALES_RETURNS",
    "VAT_PAYABLE",
    "VAT_RECOVERABLE",
    "INVENTORY",
    "COGS",
    "INV_ADJ",
    "SHRINKAGE",
    "ROUNDING",
    "OPENING_STOCK",
    "OPENING_BALANCE",
    "GRNI",
    "INTERCO_AR",
    "INTERCO_AP",
    "PURCHASES_EXPENSE",
)

ROLE_FALLBACKS = {
    # Keep runtime fallbacks conservative to avoid silent reclassification.
    "SHRINKAGE": ("INV_ADJ",),
    "ROUNDING": ("INV_ADJ", "SHRINKAGE"),
    "OPENING_STOCK": ("OPENING_BALANCE", "INV_ADJ"),
    "OPENING_BALANCE": ("OPENING_STOCK", "INV_ADJ"),
}

# Best-effort mappings for the LB template and common custom COAs.
ROLE_ACCOUNT_CODE_CANDIDATES = {
    "AR": ("4111",),
    "AP": ("4011",),
    "CASH": ("5300",),
    "BANK": ("5121",),
    "SALES": ("7010",),
    "SALES_RETURNS": ("7090", "7010"),
    "VAT_PAYABLE": ("4427",),
    "VAT_RECOVERABLE": ("4426",),
    "INVENTORY": ("3700",),
    "COGS": ("6011", "6010", "6000"),
    "INV_ADJ": ("6050", "6150", "6011"),
    "SHRINKAGE": ("6050", "6150", "6011"),
    "ROUNDING": ("6050", "6150", "6011"),
    "OPENING_STOCK": ("1099",),
    "OPENING_BALANCE": ("1099",),
    "GRNI": ("4018", "4011"),
    "INTERCO_AR": ("4111",),
    "INTERCO_AP": ("4011",),
    "PURCHASES_EXPENSE": ("6011", "6010", "6000"),
}


def _load_role_codes(cur) -> set[str]:
    cur.execute("SELECT code FROM account_roles")
    return {str(r["code"]) for r in (cur.fetchall() or []) if r.get("code")}


def _load_defaults(cur, company_id: str) -> dict[str, str]:
    cur.execute(
        """
        SELECT role_code, account_id
        FROM company_account_defaults
        WHERE company_id = %s
        """,
        (company_id,),
    )
    out: dict[str, str] = {}
    for row in cur.fetchall():
        code = str(row["role_code"])
        account_id = row["account_id"]
        if code and account_id:
            out[code] = str(account_id)
    return out


def _find_account_by_codes(cur, company_id: str, codes: Iterable[str]) -> Optional[str]:
    for code in codes:
        cur.execute(
            """
            SELECT id
            FROM company_coa_accounts
            WHERE company_id = %s AND account_code = %s AND is_postable = true
            LIMIT 1
            """,
            (company_id, code),
        )
        row = cur.fetchone()
        if row and row.get("id"):
            return str(row["id"])
    return None


def _ensure_opening_balance_account(cur, company_id: str) -> Optional[str]:
    cur.execute(
        """
        INSERT INTO company_coa_accounts (id, company_id, account_code, name_en, name_fr, name_ar, normal_balance, is_postable)
        VALUES (gen_random_uuid(), %s, '1099', 'OPENING BALANCE EQUITY', 'CAPITAL D''OUVERTURE', NULL, 'credit', true)
        ON CONFLICT (company_id, account_code) DO NOTHING
        """,
        (company_id,),
    )
    cur.execute(
        """
        SELECT id
        FROM company_coa_accounts
        WHERE company_id = %s AND account_code = '1099'
        LIMIT 1
        """,
        (company_id,),
    )
    row = cur.fetchone()
    return str(row["id"]) if row and row.get("id") else None


def _set_default(cur, company_id: str, role_code: str, account_id: str) -> None:
    cur.execute(
        """
        INSERT INTO company_account_defaults (company_id, role_code, account_id)
        VALUES (%s, %s, %s)
        ON CONFLICT (company_id, role_code) DO NOTHING
        RETURNING role_code
        """,
        (company_id, role_code, account_id),
    )
    if cur.fetchone():
        cur.execute(
            """
            INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
            VALUES (
              gen_random_uuid(),
              %s,
              NULL,
              'config.account_default.autofill',
              'company',
              %s::uuid,
              jsonb_build_object('role_code', %s, 'account_id', %s::uuid)
            )
            """,
            (company_id, company_id, role_code, account_id),
        )


def ensure_company_account_defaults(
    cur,
    company_id: str,
    roles: Optional[Iterable[str]] = None,
) -> dict[str, str]:
    """
    Best-effort self-healing for missing account-role mappings.
    We never override existing defaults; we only fill gaps.
    """
    known_roles = _load_role_codes(cur)
    defaults = _load_defaults(cur, company_id)
    target_roles = tuple(roles) if roles is not None else AUTO_HEAL_ROLES

    for role in target_roles:
        if role not in known_roles:
            continue
        if role in defaults:
            continue

        account_id: Optional[str] = None

        for fallback_role in ROLE_FALLBACKS.get(role, ()):
            account_id = defaults.get(fallback_role)
            if account_id:
                break

        if not account_id:
            account_id = _find_account_by_codes(cur, company_id, ROLE_ACCOUNT_CODE_CANDIDATES.get(role, ()))

        if not account_id and role in {"OPENING_STOCK", "OPENING_BALANCE"}:
            account_id = _ensure_opening_balance_account(cur, company_id)

        if account_id:
            _set_default(cur, company_id, role, account_id)
            defaults[role] = account_id

    return defaults
