-- Migration 157: Add replacement cost columns to price_list_items
-- These store the "replacement cost" — what it costs to buy the item today.
-- Used for PRICING DECISIONS ONLY (margin analysis, derivation markup).
-- COGS / accounting always uses historical cost from item_warehouse_costs.

ALTER TABLE price_list_items
  ADD COLUMN IF NOT EXISTS cost_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_lbp numeric(18,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN price_list_items.cost_usd IS 'Replacement cost USD — current buy price for pricing decisions. NOT for COGS.';
COMMENT ON COLUMN price_list_items.cost_lbp IS 'Replacement cost LBP — current buy price for pricing decisions. NOT for COGS.';

-- Add cost_markup_pct to the derivation mode enum
ALTER TYPE price_derivation_mode ADD VALUE IF NOT EXISTS 'cost_markup_pct';
