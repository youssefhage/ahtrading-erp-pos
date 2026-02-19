-- Backfill default user roles/profile templates for all companies.
-- Idempotent: safe to run repeatedly.

BEGIN;

-- Ensure the permissions catalog includes all codes referenced by default templates.
WITH permission_catalog(code, description) AS (
  VALUES
    ('config:read', 'Read configuration data'),
    ('config:write', 'Manage configuration data'),
    ('items:read', 'Read items and pricing'),
    ('items:write', 'Manage items and pricing'),
    ('inventory:read', 'Read inventory and stock'),
    ('inventory:write', 'Adjust inventory and stock'),
    ('sales:read', 'Read sales data'),
    ('sales:write', 'Create sales and payments'),
    ('purchases:read', 'Read purchase data'),
    ('purchases:write', 'Create purchase documents'),
    ('suppliers:read', 'Read suppliers'),
    ('suppliers:write', 'Manage suppliers'),
    ('customers:read', 'Read customers'),
    ('customers:write', 'Manage customers'),
    ('reports:read', 'Read reports'),
    ('ai:read', 'Read AI recommendations'),
    ('ai:write', 'Manage AI settings and decisions'),
    ('intercompany:write', 'Create intercompany entries'),
    ('users:read', 'Read users and roles'),
    ('users:write', 'Manage users, roles, permissions'),
    ('coa:read', 'Read chart of accounts'),
    ('coa:write', 'Manage chart of accounts'),
    ('accounting:read', 'Read accounting reports and ledgers'),
    ('accounting:write', 'Manage accounting postings and settings'),
    ('pos:manage', 'Manage POS devices')
)
INSERT INTO permissions (code, description)
SELECT pc.code, pc.description
FROM permission_catalog pc
ON CONFLICT (code) DO NOTHING;

-- Attach template_code to an existing role when names already match and
-- a template-backed role for that company/code does not exist yet.
WITH template_map(code, name) AS (
  VALUES
    ('owner_admin', 'Owner (Admin)'),
    ('manager_ops', 'Store Manager (Ops)'),
    ('manager', 'Manager'),
    ('cashier', 'Cashier'),
    ('sales', 'Sales'),
    ('inventory_clerk', 'Inventory Clerk'),
    ('purchasing', 'Purchasing'),
    ('pos_manager', 'POS Manager'),
    ('accountant', 'Accountant'),
    ('finance_clerk', 'Finance Clerk'),
    ('auditor_readonly', 'Auditor (Read Only)')
),
matched AS (
  SELECT
    r.id,
    tm.code,
    ROW_NUMBER() OVER (
      PARTITION BY r.company_id, tm.code
      ORDER BY r.created_at ASC, r.id ASC
    ) AS rn
  FROM roles r
  JOIN template_map tm
    ON lower(trim(r.name)) = lower(trim(tm.name))
  LEFT JOIN roles existing
    ON existing.company_id = r.company_id
   AND existing.template_code = tm.code
  WHERE r.template_code IS NULL
    AND existing.id IS NULL
)
UPDATE roles r
SET template_code = m.code
FROM matched m
WHERE r.id = m.id
  AND m.rn = 1;

-- Ensure each company has one role per template code.
WITH template_map(code, name) AS (
  VALUES
    ('owner_admin', 'Owner (Admin)'),
    ('manager_ops', 'Store Manager (Ops)'),
    ('manager', 'Manager'),
    ('cashier', 'Cashier'),
    ('sales', 'Sales'),
    ('inventory_clerk', 'Inventory Clerk'),
    ('purchasing', 'Purchasing'),
    ('pos_manager', 'POS Manager'),
    ('accountant', 'Accountant'),
    ('finance_clerk', 'Finance Clerk'),
    ('auditor_readonly', 'Auditor (Read Only)')
)
INSERT INTO roles (id, company_id, name, template_code)
SELECT gen_random_uuid(), c.id, tm.name, tm.code
FROM companies c
CROSS JOIN template_map tm
LEFT JOIN roles r
  ON r.company_id = c.id
 AND r.template_code = tm.code
WHERE r.id IS NULL;

-- Ensure each template-backed role has its expected permissions.
WITH template_permissions(template_code, permission_code) AS (
  VALUES
    ('owner_admin', 'config:read'),
    ('owner_admin', 'config:write'),
    ('owner_admin', 'items:read'),
    ('owner_admin', 'items:write'),
    ('owner_admin', 'inventory:read'),
    ('owner_admin', 'inventory:write'),
    ('owner_admin', 'sales:read'),
    ('owner_admin', 'sales:write'),
    ('owner_admin', 'purchases:read'),
    ('owner_admin', 'purchases:write'),
    ('owner_admin', 'suppliers:read'),
    ('owner_admin', 'suppliers:write'),
    ('owner_admin', 'customers:read'),
    ('owner_admin', 'customers:write'),
    ('owner_admin', 'reports:read'),
    ('owner_admin', 'ai:read'),
    ('owner_admin', 'ai:write'),
    ('owner_admin', 'intercompany:write'),
    ('owner_admin', 'users:read'),
    ('owner_admin', 'users:write'),
    ('owner_admin', 'coa:read'),
    ('owner_admin', 'coa:write'),
    ('owner_admin', 'accounting:read'),
    ('owner_admin', 'accounting:write'),
    ('owner_admin', 'pos:manage'),

    ('manager_ops', 'config:read'),
    ('manager_ops', 'items:read'),
    ('manager_ops', 'items:write'),
    ('manager_ops', 'inventory:read'),
    ('manager_ops', 'inventory:write'),
    ('manager_ops', 'sales:read'),
    ('manager_ops', 'sales:write'),
    ('manager_ops', 'purchases:read'),
    ('manager_ops', 'purchases:write'),
    ('manager_ops', 'suppliers:read'),
    ('manager_ops', 'suppliers:write'),
    ('manager_ops', 'customers:read'),
    ('manager_ops', 'customers:write'),
    ('manager_ops', 'reports:read'),
    ('manager_ops', 'ai:read'),
    ('manager_ops', 'pos:manage'),

    ('manager', 'config:read'),
    ('manager', 'config:write'),
    ('manager', 'items:read'),
    ('manager', 'items:write'),
    ('manager', 'inventory:read'),
    ('manager', 'inventory:write'),
    ('manager', 'sales:read'),
    ('manager', 'sales:write'),
    ('manager', 'purchases:read'),
    ('manager', 'purchases:write'),
    ('manager', 'suppliers:read'),
    ('manager', 'suppliers:write'),
    ('manager', 'customers:read'),
    ('manager', 'customers:write'),
    ('manager', 'reports:read'),
    ('manager', 'pos:manage'),

    ('cashier', 'items:read'),
    ('cashier', 'inventory:read'),
    ('cashier', 'sales:read'),
    ('cashier', 'sales:write'),
    ('cashier', 'customers:read'),
    ('cashier', 'reports:read'),

    ('sales', 'items:read'),
    ('sales', 'inventory:read'),
    ('sales', 'sales:read'),
    ('sales', 'sales:write'),
    ('sales', 'customers:read'),
    ('sales', 'customers:write'),
    ('sales', 'reports:read'),

    ('inventory_clerk', 'items:read'),
    ('inventory_clerk', 'inventory:read'),
    ('inventory_clerk', 'inventory:write'),
    ('inventory_clerk', 'reports:read'),

    ('purchasing', 'items:read'),
    ('purchasing', 'purchases:read'),
    ('purchasing', 'purchases:write'),
    ('purchasing', 'suppliers:read'),
    ('purchasing', 'suppliers:write'),
    ('purchasing', 'reports:read'),

    ('pos_manager', 'pos:manage'),
    ('pos_manager', 'items:read'),
    ('pos_manager', 'inventory:read'),
    ('pos_manager', 'sales:read'),
    ('pos_manager', 'sales:write'),
    ('pos_manager', 'customers:read'),
    ('pos_manager', 'reports:read'),

    ('accountant', 'reports:read'),
    ('accountant', 'coa:read'),
    ('accountant', 'coa:write'),
    ('accountant', 'accounting:read'),
    ('accountant', 'accounting:write'),
    ('accountant', 'config:read'),
    ('accountant', 'config:write'),

    ('finance_clerk', 'reports:read'),
    ('finance_clerk', 'coa:read'),
    ('finance_clerk', 'accounting:read'),
    ('finance_clerk', 'accounting:write'),
    ('finance_clerk', 'sales:read'),
    ('finance_clerk', 'purchases:read'),
    ('finance_clerk', 'suppliers:read'),
    ('finance_clerk', 'customers:read'),

    ('auditor_readonly', 'config:read'),
    ('auditor_readonly', 'items:read'),
    ('auditor_readonly', 'inventory:read'),
    ('auditor_readonly', 'sales:read'),
    ('auditor_readonly', 'purchases:read'),
    ('auditor_readonly', 'suppliers:read'),
    ('auditor_readonly', 'customers:read'),
    ('auditor_readonly', 'reports:read'),
    ('auditor_readonly', 'coa:read'),
    ('auditor_readonly', 'accounting:read'),
    ('auditor_readonly', 'ai:read'),
    ('auditor_readonly', 'users:read')
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN template_permissions tp
  ON tp.template_code = r.template_code
JOIN permissions p
  ON p.code = tp.permission_code
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
