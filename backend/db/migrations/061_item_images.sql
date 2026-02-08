-- Add optional primary image metadata to items for future consumer channels.
-- In v1 we reference document_attachments (bytea) by id; later this can point to CDN/object storage.

BEGIN;

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS image_attachment_id uuid,
  ADD COLUMN IF NOT EXISTS image_alt text;

CREATE INDEX IF NOT EXISTS idx_items_company_image ON items(company_id, image_attachment_id);

COMMIT;

