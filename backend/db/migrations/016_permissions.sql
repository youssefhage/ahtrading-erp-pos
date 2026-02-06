-- Permissions catalog

INSERT INTO permissions (code, description) VALUES
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
  ('reports:read', 'Read reports'),
  ('ai:read', 'Read AI recommendations'),
  ('ai:write', 'Manage AI settings and decisions'),
  ('suppliers:read', 'Read suppliers'),
  ('suppliers:write', 'Manage suppliers'),
  ('customers:read', 'Read customers'),
  ('customers:write', 'Manage customers'),
  ('intercompany:write', 'Create intercompany entries'),
  ('users:read', 'Read users and roles'),
  ('users:write', 'Manage users, roles, permissions'),
  ('coa:read', 'Read chart of accounts'),
  ('coa:write', 'Manage chart of accounts'),
  ('pos:manage', 'Manage POS devices')
ON CONFLICT (code) DO NOTHING;
