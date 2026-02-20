from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from psycopg.errors import UniqueViolation  # type: ignore
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
from ..security import hash_password
import json

router = APIRouter(prefix="/users", tags=["users"])


class UserIn(BaseModel):
    email: str
    password: str
    # Optional: assign the user to a company role at creation (one-step "add user").
    role_id: Optional[str] = None
    # Optional: use a preset template to create/ensure a role + permissions, then assign to user.
    template_code: Optional[str] = None
    # Optional alias for template_code exposed as "profile type" in admin UI.
    profile_type_code: Optional[str] = None


class RoleTemplateOut(BaseModel):
    code: str
    name: str
    description: str
    # Permission codes (from permissions catalog).
    permission_codes: list[str]


class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None


class UserAdminUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None
    deactivation_reason: Optional[str] = None


class RoleIn(BaseModel):
    name: str


class RoleUpdate(BaseModel):
    name: Optional[str] = None


class RoleAssignIn(BaseModel):
    user_id: str
    role_id: str


class UserProfileTypeAssignIn(BaseModel):
    profile_type_code: str
    replace_existing_roles: bool = True


def _has_roles_template_code_column(cur) -> bool:
    cur.execute(
        """
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'roles'
            AND column_name = 'template_code'
        ) AS ok
        """
    )
    return bool((cur.fetchone() or {}).get("ok"))


def _has_users_column(cur, column_name: str) -> bool:
    cur.execute(
        """
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'users'
            AND column_name = %s
        ) AS ok
        """,
        (column_name,),
    )
    return bool((cur.fetchone() or {}).get("ok"))


@router.get("", dependencies=[Depends(require_permission("users:read"))])
def list_users(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            has_template_code = _has_roles_template_code_column(cur)
            has_full_name = _has_users_column(cur, "full_name")
            has_phone = _has_users_column(cur, "phone")
            has_mfa_enabled = _has_users_column(cur, "mfa_enabled")
            profile_codes_select = (
                "COALESCE(array_agg(DISTINCT r.template_code) FILTER (WHERE r.template_code IS NOT NULL), ARRAY[]::text[]) AS profile_type_codes,"
                if has_template_code
                else "ARRAY[]::text[] AS profile_type_codes,"
            )
            full_name_select = "u.full_name" if has_full_name else "NULL::text AS full_name"
            phone_select = "u.phone" if has_phone else "NULL::text AS phone"
            mfa_enabled_select = "u.mfa_enabled" if has_mfa_enabled else "false AS mfa_enabled"
            group_by_cols = ["u.id", "u.email", "u.is_active"]
            if has_full_name:
                group_by_cols.append("u.full_name")
            if has_phone:
                group_by_cols.append("u.phone")
            if has_mfa_enabled:
                group_by_cols.append("u.mfa_enabled")
            cur.execute(
                f"""
                SELECT u.id,
                       u.email,
                       {full_name_select},
                       {phone_select},
                       u.is_active,
                       {mfa_enabled_select},
                       COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.id IS NOT NULL), ARRAY[]::text[]) AS role_names,
                       {profile_codes_select}
                FROM users u
                JOIN user_roles ur
                  ON ur.user_id = u.id
                LEFT JOIN roles r
                  ON r.id = ur.role_id
                 AND r.company_id = ur.company_id
                WHERE ur.company_id = %s
                GROUP BY {', '.join(group_by_cols)}
                ORDER BY u.email
                """,
                (company_id,),
            )
            rows = cur.fetchall()

            templates = _role_templates()
            templates_by_code = {t.code: t for t in templates}
            template_code_by_name = {t.name.strip().lower(): t.code for t in templates}

            users = []
            for row in rows:
                role_names = [str(x).strip() for x in list(row.get("role_names") or []) if str(x).strip()]
                raw_codes = [str(x).strip() for x in list(row.get("profile_type_codes") or []) if str(x).strip()]
                inferred_codes = {
                    template_code_by_name.get(str(name).strip().lower())
                    for name in role_names
                    if str(name).strip()
                }
                merged_codes = sorted({c for c in [*raw_codes, *list(inferred_codes)] if c})
                profile_type_code = merged_codes[0] if len(merged_codes) == 1 else ("mixed" if len(merged_codes) > 1 else None)
                profile_type_name = (
                    templates_by_code[profile_type_code].name
                    if profile_type_code and profile_type_code in templates_by_code
                    else ("Mixed / Custom" if profile_type_code == "mixed" else None)
                )
                users.append(
                    {
                        "id": row["id"],
                        "email": row["email"],
                        "full_name": row.get("full_name"),
                        "phone": row.get("phone"),
                        "is_active": bool(row.get("is_active")),
                        "mfa_enabled": bool(row.get("mfa_enabled")),
                        "role_names": role_names,
                        "profile_type_code": profile_type_code,
                        "profile_type_name": profile_type_name,
                    }
                )
            return {"users": users}


@router.get("/directory", dependencies=[Depends(require_permission("users:read"))])
def list_user_directory():
    """
    Global user directory. This is intentionally not company-scoped so admins can
    create a user and then grant access to a company.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            has_full_name = _has_users_column(cur, "full_name")
            has_phone = _has_users_column(cur, "phone")
            has_mfa_enabled = _has_users_column(cur, "mfa_enabled")
            full_name_select = "u.full_name" if has_full_name else "NULL::text AS full_name"
            phone_select = "u.phone" if has_phone else "NULL::text AS phone"
            mfa_enabled_select = "u.mfa_enabled" if has_mfa_enabled else "false AS mfa_enabled"
            cur.execute(
                """
                SELECT u.id,
                       u.email,
                       """
                + full_name_select
                + """,
                       """
                + phone_select
                + """,
                       u.is_active,
                       """
                + mfa_enabled_select
                + """
                FROM users u
                ORDER BY u.email
                """,
            )
            return {"users": cur.fetchall()}


def _role_templates() -> list[RoleTemplateOut]:
    # Keep these stable: they become a UI selector and can be referenced in docs.
    return [
        RoleTemplateOut(
            code="owner_admin",
            name="Owner (Admin)",
            description="Full access to all modules, including user and POS device management.",
            permission_codes=[
                "config:read",
                "config:write",
                "items:read",
                "items:write",
                "inventory:read",
                "inventory:write",
                "sales:read",
                "sales:write",
                "purchases:read",
                "purchases:write",
                "suppliers:read",
                "suppliers:write",
                "customers:read",
                "customers:write",
                "reports:read",
                "ai:read",
                "ai:write",
                "intercompany:write",
                "users:read",
                "users:write",
                "coa:read",
                "coa:write",
                "accounting:read",
                "accounting:write",
                "pos:manage",
            ],
        ),
        RoleTemplateOut(
            code="manager_ops",
            name="Store Manager (Ops)",
            description="Operations access across sales, inventory, catalog and partners. No user/role management.",
            permission_codes=[
                "config:read",
                "items:read",
                "items:write",
                "inventory:read",
                "inventory:write",
                "sales:read",
                "sales:write",
                "purchases:read",
                "purchases:write",
                "suppliers:read",
                "suppliers:write",
                "customers:read",
                "customers:write",
                "reports:read",
                "ai:read",
                "pos:manage",
            ],
        ),
        RoleTemplateOut(
            code="manager",
            name="Manager",
            description="Broad operational access across items, inventory, sales, purchasing, and configuration. Does not manage users/roles.",
            permission_codes=[
                "config:read",
                "config:write",
                "items:read",
                "items:write",
                "inventory:read",
                "inventory:write",
                "sales:read",
                "sales:write",
                "purchases:read",
                "purchases:write",
                "suppliers:read",
                "suppliers:write",
                "customers:read",
                "customers:write",
                "reports:read",
                "pos:manage",
            ],
        ),
        RoleTemplateOut(
            code="cashier",
            name="Cashier",
            description="POS/sales-oriented access. Limited read access to catalog/customers. No write access to configuration or inventory adjustments.",
            permission_codes=[
                "items:read",
                "inventory:read",
                "sales:read",
                "sales:write",
                "customers:read",
                "reports:read",
            ],
        ),
        RoleTemplateOut(
            code="sales",
            name="Sales",
            description="Sales access with customer management. No inventory adjustments or purchasing.",
            permission_codes=[
                "items:read",
                "inventory:read",
                "sales:read",
                "sales:write",
                "customers:read",
                "customers:write",
                "reports:read",
            ],
        ),
        RoleTemplateOut(
            code="inventory_clerk",
            name="Inventory Clerk",
            description="Warehouse/inventory operations with item read access. No sales or purchasing.",
            permission_codes=[
                "items:read",
                "inventory:read",
                "inventory:write",
                "reports:read",
            ],
        ),
        RoleTemplateOut(
            code="purchasing",
            name="Purchasing",
            description="Purchasing + suppliers with item read access. No sales or inventory adjustments.",
            permission_codes=[
                "items:read",
                "purchases:read",
                "purchases:write",
                "suppliers:read",
                "suppliers:write",
                "reports:read",
            ],
        ),
        RoleTemplateOut(
            code="pos_manager",
            name="POS Manager",
            description="Manages POS devices and sales operations. No configuration or accounting.",
            permission_codes=[
                "pos:manage",
                "items:read",
                "inventory:read",
                "sales:read",
                "sales:write",
                "customers:read",
                "reports:read",
            ],
        ),
        RoleTemplateOut(
            code="accountant",
            name="Accountant",
            description="Accounting and reporting access, including COA configuration. No sales/purchases document creation.",
            permission_codes=[
                "reports:read",
                "coa:read",
                "coa:write",
                "accounting:read",
                "accounting:write",
                "config:read",
                "config:write",
            ],
        ),
        RoleTemplateOut(
            code="finance_clerk",
            name="Finance Clerk",
            description="Accounting operations and reporting. Can review sales/purchases but does not manage configuration.",
            permission_codes=[
                "reports:read",
                "coa:read",
                "accounting:read",
                "accounting:write",
                "sales:read",
                "purchases:read",
                "suppliers:read",
                "customers:read",
            ],
        ),
        RoleTemplateOut(
            code="auditor_readonly",
            name="Auditor (Read Only)",
            description="Read-only access for review and reporting.",
            permission_codes=[
                "config:read",
                "items:read",
                "inventory:read",
                "sales:read",
                "purchases:read",
                "suppliers:read",
                "customers:read",
                "reports:read",
                "coa:read",
                "accounting:read",
                "ai:read",
                "users:read",
            ],
        ),
    ]


@router.get("/role-templates", dependencies=[Depends(require_permission("users:read"))])
def list_role_templates():
    return {"templates": [t.model_dump() for t in _role_templates()]}


@router.get("/profile-types", dependencies=[Depends(require_permission("users:read"))])
def list_profile_types():
    # Alias for role templates using user-facing naming.
    rows = [t.model_dump() for t in _role_templates()]
    return {"profile_types": rows, "templates": rows}


def _get_role_template_by_code(code: str) -> Optional[RoleTemplateOut]:
    target = (code or "").strip()
    if not target:
        return None
    return next((t for t in _role_templates() if t.code == target), None)


def _ensure_role_from_template(cur, company_id: str, template: RoleTemplateOut) -> str:
    # Make the role name stable but human friendly.
    role_name = template.name
    has_template_code = _has_roles_template_code_column(cur)

    role_id = None
    if has_template_code:
        cur.execute(
            """
            SELECT id
            FROM roles
            WHERE company_id = %s AND template_code = %s
            LIMIT 1
            """,
            (company_id, template.code),
        )
        row = cur.fetchone()
        if row:
            role_id = row["id"]

    if not role_id:
        cur.execute(
            """
            SELECT id
            FROM roles
            WHERE company_id = %s AND lower(name) = lower(%s)
            LIMIT 1
            """,
            (company_id, role_name),
        )
        row = cur.fetchone()
        if row:
            role_id = row["id"]
            if has_template_code:
                # Best effort: mark existing role as template-backed.
                try:
                    cur.execute(
                        """
                        UPDATE roles
                        SET template_code = %s
                        WHERE id = %s
                          AND company_id = %s
                          AND template_code IS NULL
                        """,
                        (template.code, role_id, company_id),
                    )
                except UniqueViolation:
                    cur.execute(
                        """
                        SELECT id
                        FROM roles
                        WHERE company_id = %s
                          AND template_code = %s
                        LIMIT 1
                        """,
                        (company_id, template.code),
                    )
                    existing = cur.fetchone()
                    if existing:
                        role_id = existing["id"]

    if not role_id:
        if has_template_code:
            try:
                cur.execute(
                    """
                    INSERT INTO roles (id, company_id, name, template_code)
                    VALUES (gen_random_uuid(), %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, role_name, template.code),
                )
            except UniqueViolation:
                cur.execute(
                    """
                    SELECT id
                    FROM roles
                    WHERE company_id = %s
                      AND template_code = %s
                    LIMIT 1
                    """,
                    (company_id, template.code),
                )
                existing = cur.fetchone()
                if not existing:
                    raise
                role_id = existing["id"]
        else:
            cur.execute(
                """
                INSERT INTO roles (id, company_id, name)
                VALUES (gen_random_uuid(), %s, %s)
                RETURNING id
                """,
                (company_id, role_name),
            )
        if not role_id:
            role_id = cur.fetchone()["id"]

    # Grant permissions from the catalog.
    for code in template.permission_codes:
        cur.execute("SELECT id FROM permissions WHERE code = %s", (code,))
        perm = cur.fetchone()
        if not perm:
            # If the DB is missing a known permission, make it obvious.
            raise HTTPException(status_code=500, detail=f"missing permission in catalog: {code}")
        cur.execute(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            VALUES (%s, %s)
            ON CONFLICT (role_id, permission_id) DO NOTHING
            """,
            (role_id, perm["id"]),
        )
    return role_id


@router.get("/me", dependencies=[Depends(require_permission("users:read"))])
def me(company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    # Company-scoped "me" view (safe for Admin UI).
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            has_full_name = _has_users_column(cur, "full_name")
            has_phone = _has_users_column(cur, "phone")
            has_mfa_enabled = _has_users_column(cur, "mfa_enabled")
            full_name_select = "u.full_name" if has_full_name else "NULL::text AS full_name"
            phone_select = "u.phone" if has_phone else "NULL::text AS phone"
            mfa_enabled_select = "u.mfa_enabled" if has_mfa_enabled else "false AS mfa_enabled"
            cur.execute(
                """
                SELECT u.id,
                       u.email,
                       """
                + full_name_select
                + """,
                       """
                + phone_select
                + """,
                       u.is_active,
                       """
                + mfa_enabled_select
                + """,
                       u.created_at,
                       u.updated_at
                FROM users u
                WHERE u.id = %s
                """,
                (user["user_id"],),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="user not found")
            return {"user": row}


@router.patch("/me", dependencies=[Depends(require_permission("users:read"))])
def update_me(
    data: UserProfileUpdate,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    patch = {k: getattr(data, k) for k in getattr(data, "model_fields_set", set())}
    if "full_name" in patch:
        patch["full_name"] = (patch.get("full_name") or "").strip() or None
    if "phone" in patch:
        patch["phone"] = (patch.get("phone") or "").strip() or None
    if not patch:
        return {"ok": True}

    with get_conn() as conn:
        with conn.cursor() as cur:
            if "full_name" in patch and not _has_users_column(cur, "full_name"):
                patch.pop("full_name", None)
            if "phone" in patch and not _has_users_column(cur, "phone"):
                patch.pop("phone", None)
            if not patch:
                return {"ok": True}

            fields = []
            params = []
            for k, v in patch.items():
                fields.append(f"{k} = %s")
                params.append(v)
            params.append(user["user_id"])
            cur.execute(
                f"""
                UPDATE users
                SET {', '.join(fields)}, updated_at = now()
                WHERE id = %s
                """,
                params,
            )
    return {"ok": True}


@router.post("", dependencies=[Depends(require_permission("users:write"))])
def create_user(data: UserIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    email = (data.email or "").strip().lower()
    password = data.password or ""
    profile_type_code = (data.profile_type_code or "").strip() or None
    template_code = (data.template_code or "").strip() or None
    if not email:
        raise HTTPException(status_code=422, detail="email is required")
    if not password:
        raise HTTPException(status_code=422, detail="password is required")
    if profile_type_code and template_code:
        raise HTTPException(status_code=422, detail="provide either profile_type_code or template_code, not both")
    selected_template_code = profile_type_code or template_code
    if selected_template_code and data.role_id:
        raise HTTPException(status_code=422, detail="provide either profile_type_code/template_code or role_id, not both")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            created = True
            try:
                cur.execute(
                    """
                    INSERT INTO users (id, email, hashed_password)
                    VALUES (gen_random_uuid(), %s, %s)
                    RETURNING id
                    """,
                    (email, hash_password(password)),
                )
                uid = cur.fetchone()["id"]
            except UniqueViolation:
                created = False
                cur.execute("SELECT id FROM users WHERE email = %s", (email,))
                row = cur.fetchone()
                if not row:
                    # Provide a clean API error for the UI.
                    raise HTTPException(status_code=409, detail="email already exists")
                uid = row["id"]
                # If the user already exists and no role/template was provided, keep the
                # old behavior (409) so callers don't assume password was updated.
                if not (selected_template_code or data.role_id):
                    raise HTTPException(status_code=409, detail="email already exists")

            # Optional: assign a role immediately.
            role_id: Optional[str] = None
            if selected_template_code:
                tmpl = next((t for t in _role_templates() if t.code == selected_template_code), None)
                if not tmpl:
                    raise HTTPException(status_code=404, detail="role template not found")
                role_id = _ensure_role_from_template(cur, company_id, tmpl)
            elif data.role_id:
                # Ensure role belongs to company.
                cur.execute("SELECT id FROM roles WHERE id = %s AND company_id = %s", (data.role_id, company_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="role not found")
                role_id = data.role_id

            if role_id:
                cur.execute(
                    """
                    INSERT INTO user_roles (user_id, role_id, company_id)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id, role_id) DO NOTHING
                    """,
                    (uid, role_id, company_id),
                )
                if not created:
                    # Ensure permission changes apply immediately for existing users.
                    cur.execute(
                        """
                        UPDATE auth_sessions
                        SET is_active = false
                        WHERE user_id = %s
                        """,
                        (uid,),
                    )

            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, %s, 'user', %s, %s::jsonb)
                """,
                (
                    company_id,
                    user["user_id"],
                    "users.create" if created else "users.grant_access",
                    uid,
                    json.dumps(
                        {
                            "email": email,
                            "assigned_role_id": role_id,
                            "template_code": selected_template_code,
                            "profile_type_code": selected_template_code,
                            "created": created,
                        }
                    ),
                ),
            )
            note = ""
            if not created:
                note = "User already existed. Password was not changed. Access was updated."
            return {"id": uid, "role_id": role_id, "created": created, "existing": (not created), "access_granted": bool(role_id), "note": note}


@router.patch("/{user_id}", dependencies=[Depends(require_permission("users:write"))])
def update_user(user_id: str, data: UserAdminUpdate, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = {k: getattr(data, k) for k in getattr(data, "model_fields_set", set())}
    if "email" in patch:
        patch["email"] = (patch.get("email") or "").strip().lower() or None
        if not patch["email"]:
            raise HTTPException(status_code=422, detail="email cannot be empty")
    if "full_name" in patch:
        patch["full_name"] = (patch.get("full_name") or "").strip() or None
    if "phone" in patch:
        patch["phone"] = (patch.get("phone") or "").strip() or None
    if "deactivation_reason" in patch:
        patch["deactivation_reason"] = (patch.get("deactivation_reason") or "").strip() or None
    if not patch:
        return {"ok": True}

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                has_full_name = _has_users_column(cur, "full_name")
                has_phone = _has_users_column(cur, "phone")
                has_deactivated_at = _has_users_column(cur, "deactivated_at")
                has_deactivation_reason = _has_users_column(cur, "deactivation_reason")

                if "full_name" in patch and not has_full_name:
                    patch.pop("full_name", None)
                if "phone" in patch and not has_phone:
                    patch.pop("phone", None)
                if "deactivation_reason" in patch and not has_deactivation_reason:
                    patch.pop("deactivation_reason", None)

                cur.execute(
                    """
                    SELECT 1
                    FROM user_roles
                    WHERE user_id = %s AND company_id = %s
                    LIMIT 1
                    """,
                    (user_id, company_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="user not found")

                fields = []
                params = []
                for key in ("email", "full_name", "phone"):
                    if key in patch:
                        fields.append(f"{key} = %s")
                        params.append(patch[key])
                if "is_active" in patch:
                    next_active = bool(patch["is_active"])
                    fields.append("is_active = %s")
                    params.append(next_active)
                    if next_active:
                        if has_deactivated_at:
                            fields.append("deactivated_at = NULL")
                        if has_deactivation_reason:
                            fields.append("deactivation_reason = NULL")
                    else:
                        if has_deactivated_at:
                            fields.append("deactivated_at = now()")
                        if has_deactivation_reason:
                            fields.append("deactivation_reason = %s")
                            params.append((patch.get("deactivation_reason") or "").strip() or "deactivated by admin")
                elif "deactivation_reason" in patch and has_deactivation_reason:
                    fields.append("deactivation_reason = %s")
                    params.append(patch["deactivation_reason"])

                if not fields:
                    return {"ok": True}

                try:
                    cur.execute(
                        f"""
                        UPDATE users
                        SET {', '.join(fields)}, updated_at = now()
                        WHERE id = %s
                        """,
                        [*params, user_id],
                    )
                except UniqueViolation:
                    raise HTTPException(status_code=409, detail="email already exists")
                if "is_active" in patch and patch["is_active"] is False:
                    cur.execute(
                        """
                        UPDATE auth_sessions
                        SET is_active = false
                        WHERE user_id = %s
                        """,
                        (user_id,),
                    )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'users.update', 'user', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], user_id, json.dumps(patch)),
                )
                return {"ok": True}


@router.delete("/{user_id}", dependencies=[Depends(require_permission("users:write"))])
def remove_user_from_company(user_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="you cannot remove your own access")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM user_roles
                    WHERE company_id = %s AND user_id = %s
                    RETURNING role_id
                    """,
                    (company_id, user_id),
                )
                removed_roles = [r["role_id"] for r in cur.fetchall()]
                if not removed_roles:
                    raise HTTPException(status_code=404, detail="user not found")

                cur.execute(
                    """
                    UPDATE auth_sessions
                    SET is_active = false
                    WHERE user_id = %s
                    """,
                    (user_id,),
                )

                cur.execute(
                    """
                    SELECT COUNT(*)::int AS n
                    FROM user_roles
                    WHERE user_id = %s
                    """,
                    (user_id,),
                )
                remaining = int((cur.fetchone() or {}).get("n") or 0)

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'users.remove_company_access', 'user', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        user_id,
                        json.dumps(
                            {
                                "removed_role_ids": removed_roles,
                                "remaining_role_assignments": remaining,
                                "deleted_user_row": False,
                            }
                        ),
                    ),
                )
                return {"ok": True, "deleted_user": False}


@router.post("/{user_id}/mfa/reset", dependencies=[Depends(require_permission("users:write"))])
def reset_user_mfa(user_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Admin operation: disable MFA for a user and revoke their sessions (account recovery).
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                # Only allow acting on users that belong to this company.
                cur.execute(
                    """
                    SELECT 1
                    FROM user_roles
                    WHERE user_id = %s AND company_id = %s
                    LIMIT 1
                    """,
                    (user_id, company_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="user not found")

                cur.execute(
                    """
                    UPDATE users
                    SET mfa_enabled = false,
                        mfa_secret_enc = NULL,
                        mfa_pending_secret_enc = NULL,
                        mfa_verified_at = NULL,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (user_id,),
                )
                cur.execute(
                    """
                    UPDATE auth_sessions
                    SET is_active = false
                    WHERE user_id = %s
                    """,
                    (user_id,),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'users.mfa.reset', 'user', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], user_id, json.dumps({})),
                )
                return {"ok": True}


@router.get("/roles", dependencies=[Depends(require_permission("users:read"))])
def list_roles(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            has_template_code = _has_roles_template_code_column(cur)
            template_select = "r.template_code," if has_template_code else "NULL::text AS template_code,"
            group_by = "r.id, r.name, r.template_code" if has_template_code else "r.id, r.name"
            cur.execute(
                f"""
                SELECT
                  r.id,
                  r.name,
                  {template_select}
                  COUNT(ur.user_id)::int AS assigned_users
                FROM roles
                r
                LEFT JOIN user_roles ur ON ur.role_id = r.id AND ur.company_id = r.company_id
                WHERE r.company_id = %s
                GROUP BY {group_by}
                ORDER BY r.name
                """,
                (company_id,),
            )
            return {"roles": cur.fetchall()}


@router.post("/roles", dependencies=[Depends(require_permission("users:write"))])
def create_role(data: RoleIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO roles (id, company_id, name)
                VALUES (gen_random_uuid(), %s, %s)
                RETURNING id
                """,
                (company_id, data.name),
            )
            rid = cur.fetchone()["id"]
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'users.role.create', 'role', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], rid, json.dumps({"name": data.name})),
            )
            return {"id": rid}


@router.post("/roles/seed-defaults", dependencies=[Depends(require_permission("users:write"))])
def seed_default_roles(company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Ensure common roles exist for a company using the role templates catalog.
    This is safe to call multiple times (idempotent).
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                out = []
                created_n = 0
                for tmpl in _role_templates():
                    cur.execute(
                        """
                        SELECT id
                        FROM roles
                        WHERE company_id = %s AND lower(name) = lower(%s)
                        LIMIT 1
                        """,
                        (company_id, tmpl.name),
                    )
                    existed = cur.fetchone() is not None
                    rid = _ensure_role_from_template(cur, company_id, tmpl)
                    out.append({"code": tmpl.code, "name": tmpl.name, "role_id": rid, "created": (not existed)})
                    if not existed:
                        created_n += 1
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'users.roles.seed_defaults', 'role', NULL, %s::jsonb)
                    """,
                    (company_id, user["user_id"], json.dumps({"created": created_n, "total": len(out)})),
                )
                return {"ok": True, "created": created_n, "roles": out}


@router.patch("/roles/{role_id}", dependencies=[Depends(require_permission("users:write"))])
def update_role(role_id: str, data: RoleUpdate, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = {k: getattr(data, k) for k in getattr(data, "model_fields_set", set())}
    if "name" in patch:
        patch["name"] = (patch.get("name") or "").strip()
        if not patch["name"]:
            raise HTTPException(status_code=422, detail="name cannot be empty")
    if not patch:
        return {"ok": True}

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE roles
                    SET name = %s
                    WHERE id = %s AND company_id = %s
                    """,
                    (patch["name"], role_id, company_id),
                )
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="role not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'users.role.update', 'role', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], role_id, json.dumps(patch)),
                )
                return {"ok": True}


@router.delete("/roles/{role_id}", dependencies=[Depends(require_permission("users:write"))])
def delete_role(role_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM roles WHERE id = %s AND company_id = %s",
                    (role_id, company_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="role not found")
                cur.execute(
                    """
                    SELECT COUNT(*)::int AS n
                    FROM user_roles
                    WHERE company_id = %s AND role_id = %s
                    """,
                    (company_id, role_id),
                )
                assigned = int((cur.fetchone() or {}).get("n") or 0)
                if assigned > 0:
                    raise HTTPException(status_code=409, detail=f"role is assigned to {assigned} user(s)")

                cur.execute(
                    """
                    DELETE FROM roles
                    WHERE id = %s AND company_id = %s
                    """,
                    (role_id, company_id),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'users.role.delete', 'role', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], role_id, json.dumps({"assigned_users": assigned})),
                )
                return {"ok": True}


@router.post("/roles/assign", dependencies=[Depends(require_permission("users:write"))])
def assign_role(data: RoleAssignIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            # ensure role belongs to company
            cur.execute("SELECT id FROM roles WHERE id = %s AND company_id = %s", (data.role_id, company_id))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="role not found")
            cur.execute(
                """
                INSERT INTO user_roles (user_id, role_id, company_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, role_id) DO NOTHING
                """,
                (data.user_id, data.role_id, company_id),
            )
            # Role changes should invalidate sessions so permissions update immediately.
            cur.execute(
                """
                UPDATE auth_sessions
                SET is_active = false
                WHERE user_id = %s
                """,
                (data.user_id,),
            )
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'users.role.assign', 'user', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], data.user_id, json.dumps({"role_id": data.role_id})),
            )
            return {"ok": True}


@router.post("/{user_id}/profile-type", dependencies=[Depends(require_permission("users:write"))])
def assign_user_profile_type(
    user_id: str,
    data: UserProfileTypeAssignIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    profile_type_code = (data.profile_type_code or "").strip()
    if not profile_type_code:
        raise HTTPException(status_code=422, detail="profile_type_code is required")
    template = _get_role_template_by_code(profile_type_code)
    if not template:
        raise HTTPException(status_code=404, detail="profile type not found")
    if user_id == user["user_id"] and data.replace_existing_roles and "users:write" not in template.permission_codes:
        raise HTTPException(status_code=400, detail="cannot remove your own users:write access")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM users WHERE id = %s", (user_id,))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="user not found")

                role_id = _ensure_role_from_template(cur, company_id, template)

                if data.replace_existing_roles:
                    cur.execute(
                        """
                        DELETE FROM user_roles
                        WHERE company_id = %s
                          AND user_id = %s
                          AND role_id <> %s
                        """,
                        (company_id, user_id, role_id),
                    )
                cur.execute(
                    """
                    INSERT INTO user_roles (user_id, role_id, company_id)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id, role_id) DO NOTHING
                    """,
                    (user_id, role_id, company_id),
                )

                cur.execute(
                    """
                    UPDATE auth_sessions
                    SET is_active = false
                    WHERE user_id = %s
                    """,
                    (user_id,),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'users.profile_type.assign', 'user', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        user_id,
                        json.dumps(
                            {
                                "profile_type_code": template.code,
                                "profile_type_name": template.name,
                                "role_id": role_id,
                                "replace_existing_roles": bool(data.replace_existing_roles),
                            }
                        ),
                    ),
                )
                return {
                    "ok": True,
                    "user_id": user_id,
                    "profile_type_code": template.code,
                    "profile_type_name": template.name,
                    "role_id": role_id,
                }


class RolePermissionIn(BaseModel):
    role_id: str
    permission_code: str


@router.get("/permissions", dependencies=[Depends(require_permission("users:read"))])
def list_permissions(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, description
                FROM permissions
                ORDER BY code
                """,
            )
            return {"permissions": cur.fetchall()}


@router.get("/roles/{role_id}/permissions", dependencies=[Depends(require_permission("users:read"))])
def list_role_permissions(role_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.code, p.description
                FROM role_permissions rp
                JOIN permissions p ON p.id = rp.permission_id
                WHERE rp.role_id = %s
                ORDER BY p.code
                """,
                (role_id,),
            )
            return {"permissions": cur.fetchall()}


@router.post("/roles/permissions", dependencies=[Depends(require_permission("users:write"))])
def assign_role_permission(data: RolePermissionIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM roles WHERE id = %s AND company_id = %s",
                (data.role_id, company_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="role not found")
            cur.execute(
                "SELECT id FROM permissions WHERE code = %s",
                (data.permission_code,),
            )
            perm = cur.fetchone()
            if not perm:
                raise HTTPException(status_code=404, detail="permission not found")
            cur.execute(
                """
                INSERT INTO role_permissions (role_id, permission_id)
                VALUES (%s, %s)
                ON CONFLICT (role_id, permission_id) DO NOTHING
                """,
                (data.role_id, perm["id"]),
            )
            # Permission changes should invalidate sessions for users with this role.
            cur.execute(
                """
                UPDATE auth_sessions
                SET is_active = false
                WHERE user_id IN (
                  SELECT user_id
                  FROM user_roles
                  WHERE company_id = %s AND role_id = %s
                )
                """,
                (company_id, data.role_id),
            )
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'users.role_permission.assign', 'role', %s, %s::jsonb)
                """,
                (
                    company_id,
                    user["user_id"],
                    data.role_id,
                    json.dumps({"permission_code": data.permission_code}),
                ),
            )
            return {"ok": True}


@router.delete("/roles/{role_id}/permissions/{permission_code}", dependencies=[Depends(require_permission("users:write"))])
def revoke_role_permission(
    role_id: str,
    permission_code: str,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM roles WHERE id = %s AND company_id = %s",
                    (role_id, company_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="role not found")
                cur.execute("SELECT id FROM permissions WHERE code = %s", (permission_code,))
                perm = cur.fetchone()
                if not perm:
                    raise HTTPException(status_code=404, detail="permission not found")
                cur.execute(
                    """
                    DELETE FROM role_permissions
                    WHERE role_id = %s AND permission_id = %s
                    """,
                    (role_id, perm["id"]),
                )
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="permission not assigned to role")
                cur.execute(
                    """
                    UPDATE auth_sessions
                    SET is_active = false
                    WHERE user_id IN (
                      SELECT user_id
                      FROM user_roles
                      WHERE company_id = %s AND role_id = %s
                    )
                    """,
                    (company_id, role_id),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'users.role_permission.revoke', 'role', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        role_id,
                        json.dumps({"permission_code": permission_code}),
                    ),
                )
                return {"ok": True}


@router.post("/{user_id}/sessions/revoke", dependencies=[Depends(require_permission("users:write"))])
def revoke_user_sessions(user_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Company-admin operation: revoke all auth sessions for a user in this company.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            # Only allow revoking sessions for users that belong to this company.
            cur.execute(
                """
                SELECT 1
                FROM user_roles
                WHERE user_id = %s AND company_id = %s
                LIMIT 1
                """,
                (user_id, company_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="user not found")

            cur.execute(
                """
                UPDATE auth_sessions
                SET is_active = false
                WHERE user_id = %s
                """,
                (user_id,),
            )
            revoked = cur.rowcount
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'users.sessions.revoke', 'user', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], user_id, json.dumps({"revoked": revoked})),
            )
            return {"ok": True, "revoked": revoked}


@router.post("/sessions/revoke-all", dependencies=[Depends(require_permission("users:write"))])
def revoke_all_company_sessions(company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Company-admin incident-response operation: revoke all sessions for all users that belong to this company.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE auth_sessions
                SET is_active = false
                WHERE user_id IN (
                  SELECT DISTINCT user_id
                  FROM user_roles
                  WHERE company_id = %s
                )
                """,
                (company_id,),
            )
            revoked = cur.rowcount
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'users.sessions.revoke_all', 'company', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], company_id, json.dumps({"revoked": revoked})),
            )
            return {"ok": True, "revoked": revoked}


class DeactivateUserIn(BaseModel):
    reason: Optional[str] = None


@router.post("/{user_id}/deactivate", dependencies=[Depends(require_permission("users:write"))])
def deactivate_user(user_id: str, data: DeactivateUserIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    reason = (data.reason or "").strip() or None
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT 1
                    FROM user_roles
                    WHERE user_id = %s AND company_id = %s
                    LIMIT 1
                    """,
                    (user_id, company_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="user not found")
                cur.execute(
                    """
                    UPDATE users
                    SET is_active = false,
                        deactivated_at = now(),
                        deactivation_reason = %s,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (reason, user_id),
                )
                cur.execute("UPDATE auth_sessions SET is_active=false WHERE user_id=%s", (user_id,))
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'users.deactivate', 'user', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], user_id, json.dumps({"reason": reason})),
                )
                return {"ok": True}


@router.post("/{user_id}/activate", dependencies=[Depends(require_permission("users:write"))])
def activate_user(user_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT 1
                    FROM user_roles
                    WHERE user_id = %s AND company_id = %s
                    LIMIT 1
                    """,
                    (user_id, company_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="user not found")
                cur.execute(
                    """
                    UPDATE users
                    SET is_active = true,
                        deactivated_at = NULL,
                        deactivation_reason = NULL,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (user_id,),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'users.activate', 'user', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], user_id, json.dumps({})),
                )
                return {"ok": True}
