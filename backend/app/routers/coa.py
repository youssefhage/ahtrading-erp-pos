from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission

router = APIRouter(prefix="/coa", tags=["coa"])


class CoaAccountUpdate(BaseModel):
    name_en: Optional[str] = None
    name_fr: Optional[str] = None
    name_ar: Optional[str] = None
    is_postable: Optional[bool] = None
    parent_account_id: Optional[str] = None


class CoaCloneIn(BaseModel):
    template_code: str
    effective_from: str


class CoaMappingIn(BaseModel):
    source_account_id: str
    target_template_account_id: str
    mapping_type: str = "direct"
    effective_from: str
    effective_to: Optional[str] = None


@router.get("/templates", dependencies=[Depends(require_permission("coa:read"))])
def list_templates():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, name, description, default_language
                FROM coa_templates
                ORDER BY name
                """,
            )
            return {"templates": cur.fetchall()}


class CoaTemplateIn(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    default_language: str = "en"


@router.post("/templates", dependencies=[Depends(require_permission("coa:write"))])
def create_template(data: CoaTemplateIn):
    code = (data.code or "").strip()
    name = (data.name or "").strip()
    if not code or not name:
        raise HTTPException(status_code=400, detail="code and name are required")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO coa_templates (id, code, name, description, default_language)
                VALUES (gen_random_uuid(), %s, %s, %s, %s)
                ON CONFLICT (code) DO UPDATE
                SET name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    default_language = EXCLUDED.default_language
                RETURNING id
                """,
                (code, name, (data.description or "").strip() or None, (data.default_language or "en").strip() or "en"),
            )
            return {"id": cur.fetchone()["id"]}


@router.get("/templates/{template_id}/accounts", dependencies=[Depends(require_permission("coa:read"))])
def list_template_accounts(template_id: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, account_code, name_en, name_fr, name_ar, normal_balance_raw, is_postable_default, created_at
                FROM coa_template_accounts
                WHERE template_id = %s
                ORDER BY account_code
                """,
                (template_id,),
            )
            return {"accounts": cur.fetchall()}


class TemplateAccountIn(BaseModel):
    account_code: str
    name_en: Optional[str] = None
    name_fr: Optional[str] = None
    name_ar: Optional[str] = None
    normal_balance_raw: Optional[str] = None
    is_postable_default: bool = True


class TemplateAccountsBulkIn(BaseModel):
    accounts: List[TemplateAccountIn]


@router.post("/templates/{template_id}/accounts/bulk", dependencies=[Depends(require_permission("coa:write"))])
def bulk_upsert_template_accounts(template_id: str, data: TemplateAccountsBulkIn):
    accounts = data.accounts or []
    if not accounts:
        raise HTTPException(status_code=400, detail="accounts is required")
    if len(accounts) > 5000:
        raise HTTPException(status_code=400, detail="too many accounts (max 5000)")
    with get_conn() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM coa_templates WHERE id=%s", (template_id,))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="template not found")
                upserted = 0
                for a in accounts:
                    code = (a.account_code or "").strip()
                    if not code:
                        raise HTTPException(status_code=400, detail="each account requires account_code")
                    cur.execute(
                        """
                        INSERT INTO coa_template_accounts
                          (id, template_id, account_code, name_en, name_fr, name_ar, normal_balance_raw, is_postable_default)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (template_id, account_code) DO UPDATE
                        SET name_en = EXCLUDED.name_en,
                            name_fr = EXCLUDED.name_fr,
                            name_ar = EXCLUDED.name_ar,
                            normal_balance_raw = EXCLUDED.normal_balance_raw,
                            is_postable_default = EXCLUDED.is_postable_default
                        """,
                        (
                            template_id,
                            code,
                            (a.name_en or "").strip() or None,
                            (a.name_fr or "").strip() or None,
                            (a.name_ar or "").strip() or None,
                            (a.normal_balance_raw or "").strip() or None,
                            bool(a.is_postable_default),
                        ),
                    )
                    upserted += 1
                return {"ok": True, "upserted": upserted}


@router.post("/clone", dependencies=[Depends(require_permission("coa:write"))])
def clone_template(data: CoaCloneIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT clone_coa_template_to_company(%s, %s, %s)",
                (company_id, data.template_code, data.effective_from),
            )
            return {"ok": True}


@router.get("/accounts", dependencies=[Depends(require_permission("coa:read"))])
def list_accounts(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, account_code, name_en, name_fr, name_ar, normal_balance, is_postable, parent_account_id
                FROM company_coa_accounts
                WHERE company_id = %s
                ORDER BY account_code
                """,
                (company_id,),
            )
            return {"accounts": cur.fetchall()}


@router.patch("/accounts/{account_id}", dependencies=[Depends(require_permission("coa:write"))])
def update_account(account_id: str, data: CoaAccountUpdate, company_id: str = Depends(get_company_id)):
    fields = []
    params = []
    for k, v in data.model_dump(exclude_none=True).items():
        fields.append(f"{k} = %s")
        params.append(v)
    if not fields:
        return {"ok": True}
    params.extend([company_id, account_id])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE company_coa_accounts
                SET {', '.join(fields)}
                WHERE company_id = %s AND id = %s
                """,
                params,
            )
            return {"ok": True}


@router.get("/mappings", dependencies=[Depends(require_permission("coa:read"))])
def list_mappings(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, source_account_id, target_template_account_id, mapping_type, effective_from, effective_to
                FROM coa_mappings
                WHERE company_id = %s
                ORDER BY effective_from DESC
                """,
                (company_id,),
            )
            return {"mappings": cur.fetchall()}


@router.post("/mappings", dependencies=[Depends(require_permission("coa:write"))])
def create_mapping(data: CoaMappingIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO coa_mappings
                  (id, company_id, source_account_id, target_template_account_id, mapping_type, effective_from, effective_to)
                VALUES
                  (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (company_id, data.source_account_id, data.target_template_account_id, data.mapping_type, data.effective_from, data.effective_to),
            )
            return {"id": cur.fetchone()["id"]}
