from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission

router = APIRouter(prefix="/customers", tags=["customers"])


class CustomerIn(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    credit_limit_usd: Optional[float] = None
    credit_limit_lbp: Optional[float] = None


@router.get("", dependencies=[Depends(require_permission("customers:read"))])
def list_customers(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, phone, email,
                       credit_limit_usd, credit_limit_lbp,
                       credit_balance_usd, credit_balance_lbp,
                       loyalty_points
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
            cur.execute(
                """
                INSERT INTO customers
                  (id, company_id, name, phone, email, credit_limit_usd, credit_limit_lbp)
                VALUES
                  (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    company_id,
                    data.name,
                    data.phone,
                    data.email,
                    data.credit_limit_usd or 0,
                    data.credit_limit_lbp or 0,
                ),
            )
            return {"id": cur.fetchone()["id"]}


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    credit_limit_usd: Optional[float] = None
    credit_limit_lbp: Optional[float] = None


@router.patch("/{customer_id}", dependencies=[Depends(require_permission("customers:write"))])
def update_customer(customer_id: str, data: CustomerUpdate, company_id: str = Depends(get_company_id)):
    fields = []
    params = []
    for k, v in data.model_dump(exclude_none=True).items():
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
