-- Additional permissions for accounting operations (manual journals, period controls, etc).

INSERT INTO permissions (code, description) VALUES
  ('accounting:read', 'Read accounting journals and subledger reports'),
  ('accounting:write', 'Create accounting journals and adjustments')
ON CONFLICT (code) DO NOTHING;

