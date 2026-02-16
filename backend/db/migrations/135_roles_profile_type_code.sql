-- Persist role/profile type identity so user profile assignments are stable
-- even when role display names are edited.

ALTER TABLE roles
ADD COLUMN IF NOT EXISTS template_code text;

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
  WHERE r.template_code IS NULL
)
UPDATE roles r
SET template_code = m.code
FROM matched m
WHERE r.id = m.id
  AND m.rn = 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_company_template_code
  ON roles (company_id, template_code)
  WHERE template_code IS NOT NULL;
