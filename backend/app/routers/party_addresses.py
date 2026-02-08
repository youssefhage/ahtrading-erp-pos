from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Literal

from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user

router = APIRouter(prefix="/party-addresses", tags=["party-addresses"])

PartyKind = Literal["customer", "supplier"]


class AddressIn(BaseModel):
    party_kind: PartyKind
    party_id: str
    label: Optional[str] = None
    line1: Optional[str] = None
    line2: Optional[str] = None
    city: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None
    postal_code: Optional[str] = None
    is_default: bool = False


class AddressUpdate(BaseModel):
    label: Optional[str] = None
    line1: Optional[str] = None
    line2: Optional[str] = None
    city: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None
    postal_code: Optional[str] = None
    is_default: Optional[bool] = None


def _ensure_party_exists(cur, company_id: str, kind: PartyKind, party_id: str):
    if kind == "customer":
        cur.execute("SELECT 1 FROM customers WHERE company_id=%s AND id=%s", (company_id, party_id))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="customer not found")
    else:
        cur.execute("SELECT 1 FROM suppliers WHERE company_id=%s AND id=%s", (company_id, party_id))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="supplier not found")


def _require(code: str, company_id: str, user: dict):
    # Reuse the existing permission dependency as a normal function.
    require_permission(code)(company_id=company_id, user=user)


@router.get("")
def list_addresses(
    party_kind: PartyKind,
    party_id: str,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    _require("customers:read" if party_kind == "customer" else "suppliers:read", company_id, user)

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            _ensure_party_exists(cur, company_id, party_kind, party_id)
            cur.execute(
                """
                SELECT id, label, line1, line2, city, region, country, postal_code, is_default, created_at, updated_at
                FROM party_addresses
                WHERE company_id=%s AND party_kind=%s AND party_id=%s
                ORDER BY is_default DESC, updated_at DESC
                """,
                (company_id, party_kind, party_id),
            )
            return {"addresses": cur.fetchall()}


@router.post("")
def create_address(
    data: AddressIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    _require("customers:write" if data.party_kind == "customer" else "suppliers:write", company_id, user)

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                _ensure_party_exists(cur, company_id, data.party_kind, data.party_id)

                if data.is_default:
                    cur.execute(
                        """
                        UPDATE party_addresses
                        SET is_default=false
                        WHERE company_id=%s AND party_kind=%s AND party_id=%s
                        """,
                        (company_id, data.party_kind, data.party_id),
                    )

                cur.execute(
                    """
                    INSERT INTO party_addresses
                      (id, company_id, party_kind, party_id, label, line1, line2, city, region, country, postal_code, is_default)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        data.party_kind,
                        data.party_id,
                        (data.label or "").strip() or None,
                        (data.line1 or "").strip() or None,
                        (data.line2 or "").strip() or None,
                        (data.city or "").strip() or None,
                        (data.region or "").strip() or None,
                        (data.country or "").strip() or None,
                        (data.postal_code or "").strip() or None,
                        bool(data.is_default),
                    ),
                )
                return {"id": cur.fetchone()["id"]}


@router.patch("/{address_id}")
def update_address(
    address_id: str,
    data: AddressUpdate,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}

    fields = []
    params = []
    for k in ["label", "line1", "line2", "city", "region", "country", "postal_code"]:
        if k in patch:
            fields.append(f"{k}=%s")
            params.append((patch[k] or "").strip() or None)

    is_default = patch.get("is_default") if "is_default" in patch else None

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT party_kind, party_id
                    FROM party_addresses
                    WHERE company_id=%s AND id=%s
                    """,
                    (company_id, address_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="address not found")

                _require("customers:write" if row["party_kind"] == "customer" else "suppliers:write", company_id, user)

                if is_default is True:
                    cur.execute(
                        """
                        UPDATE party_addresses
                        SET is_default=false
                        WHERE company_id=%s AND party_kind=%s AND party_id=%s
                        """,
                        (company_id, row["party_kind"], row["party_id"]),
                    )

                if "is_default" in patch:
                    fields.append("is_default=%s")
                    params.append(bool(is_default))

                if not fields:
                    return {"ok": True}

                params.extend([company_id, address_id])
                cur.execute(
                    f"""
                    UPDATE party_addresses
                    SET {', '.join(fields)}
                    WHERE company_id=%s AND id=%s
                    """,
                    params,
                )
                return {"ok": True}


@router.delete("/{address_id}")
def delete_address(
    address_id: str,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT party_kind
                    FROM party_addresses
                    WHERE company_id=%s AND id=%s
                    """,
                    (company_id, address_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="address not found")

                _require("customers:write" if row["party_kind"] == "customer" else "suppliers:write", company_id, user)

                cur.execute(
                    """
                    DELETE FROM party_addresses
                    WHERE company_id=%s AND id=%s
                    RETURNING id
                    """,
                    (company_id, address_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="address not found")
                return {"ok": True}
