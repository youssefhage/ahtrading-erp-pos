-- Add canonical item_type + tags for catalog governance.
-- item_type: stocked | service | bundle
-- tags: lightweight text[] for filtering/merchandising/integrations.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_type') THEN
    CREATE TYPE item_type AS ENUM ('stocked', 'service', 'bundle');
  END IF;
END $$;

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS item_type item_type NOT NULL DEFAULT 'stocked',
  ADD COLUMN IF NOT EXISTS tags text[] NULL;

CREATE INDEX IF NOT EXISTS idx_items_tags_gin ON items USING gin (tags);

