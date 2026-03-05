-- Allow managers and owners to edit posted sales invoices.
-- New permission: sales:edit_posted

BEGIN;

INSERT INTO permissions (id, code, description)
VALUES (gen_random_uuid(), 'sales:edit_posted', 'Edit posted sales invoices')
ON CONFLICT (code) DO NOTHING;

-- Grant to owner_admin and manager roles.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.template_code IN ('owner_admin', 'manager')
  AND p.code = 'sales:edit_posted'
ON CONFLICT DO NOTHING;

COMMIT;
