-- ============================================
-- 014: Data Lifecycle & Referential Integrity (Phase 5)
--   - Soft-delete columns (PRD §55, Rule #11)
--   - Ledger & stock-balance protection: CASCADE → RESTRICT
--   - Atomic per-workspace document sequences (PRD §46)
--   - Workspace-wide variant SKU uniqueness
--   - Numeric sanity CHECKs
-- ============================================

-- 1. SOFT-DELETE COLUMNS
ALTER TABLE public.products    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.warehouses  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.suppliers   ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.customers   ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.categories  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.brands      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_products_archived   ON public.products(workspace_id)   WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warehouses_archived ON public.warehouses(workspace_id) WHERE archived_at IS NOT NULL;

-- 2. LEDGER + STOCK PROTECTION: CASCADE → RESTRICT
-- Deleting a product/warehouse that has history must FAIL, not silently erase
-- the immutable ledger (Rule #4/#11). Soft-delete (section 3 of the app) makes
-- this path rare anyway; RESTRICT is the DB-level backstop.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname, con.relname
    FROM (
      SELECT c.conname, 'inventory_transactions' AS relname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid AND t.relname = 'inventory_transactions'
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname IN ('product_id','warehouse_id')
      WHERE c.contype = 'f' AND c.conrelid = t.oid AND c.confdeltype = 'c'
      GROUP BY c.conname
      UNION
      SELECT c.conname, 'inventory' AS relname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid AND t.relname = 'inventory'
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname IN ('product_id','warehouse_id')
      WHERE c.contype = 'f' AND c.conrelid = t.oid AND c.confdeltype = 'c'
      GROUP BY c.conname
    ) con
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.relname, r.conname);
  END LOOP;
END $$;

-- Recreate as RESTRICT (only the two FKs that were CASCADE).
-- inventory_transactions.product_id / .warehouse_id
ALTER TABLE public.inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_product_id_fkey;
ALTER TABLE public.inventory_transactions
  ADD CONSTRAINT inventory_transactions_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

ALTER TABLE public.inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_warehouse_id_fkey;
ALTER TABLE public.inventory_transactions
  ADD CONSTRAINT inventory_transactions_warehouse_id_fkey
  FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT;

-- inventory.product_id / .warehouse_id
ALTER TABLE public.inventory
  DROP CONSTRAINT IF EXISTS inventory_product_id_fkey;
ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

ALTER TABLE public.inventory
  DROP CONSTRAINT IF EXISTS inventory_warehouse_id_fkey;
ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_warehouse_id_fkey
  FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT;

-- 3. ATOMIC DOCUMENT SEQUENCES (PRD §46: collision-proof numbering)
CREATE TABLE IF NOT EXISTS public.document_sequences (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  last_number INT NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, doc_type)
);

CREATE OR REPLACE FUNCTION public.next_document_number(
  p_workspace UUID,
  p_type TEXT,
  p_prefix TEXT
) RETURNS TEXT AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM NOW());
  v_next INT;
BEGIN
  INSERT INTO public.document_sequences AS ds (workspace_id, doc_type, last_number)
  VALUES (p_workspace, p_type, 1)
  ON CONFLICT (workspace_id, doc_type)
  DO UPDATE SET last_number = ds.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN format('%s-%s-%s', p_prefix, v_year, lpad(v_next::text, 6, '0'));
END;
$$ LANGUAGE plpgsql;

-- 4. WORKSPACE-WIDE VARIANT SKU UNIQUENESS
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS workspace_id UUID;

-- Backfill from the parent product (idempotent: only fills NULLs)
UPDATE public.product_variants pv
SET workspace_id = p.workspace_id
FROM public.products p
WHERE pv.product_id = p.id AND pv.workspace_id IS NULL;

ALTER TABLE public.product_variants
  ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_workspace_fk
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

-- Workspace-wide uniqueness (per-product uniqueness already exists)
ALTER TABLE public.product_variants
  DROP CONSTRAINT IF EXISTS product_variants_workspace_sku_unique;
ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_workspace_sku_unique
  UNIQUE (workspace_id, sku);

CREATE INDEX IF NOT EXISTS idx_product_variants_workspace
  ON public.product_variants(workspace_id);

-- 5. NUMERIC SANITY CHECKS (PRD §46)
ALTER TABLE public.purchase_order_items
  DROP CONSTRAINT IF EXISTS poi_unit_cost_nonnegative;
ALTER TABLE public.purchase_order_items
  ADD CONSTRAINT poi_unit_cost_nonnegative CHECK (unit_cost >= 0);

ALTER TABLE public.purchase_order_items
  DROP CONSTRAINT IF EXISTS poi_ordered_qty_positive;
ALTER TABLE public.purchase_order_items
  ADD CONSTRAINT poi_ordered_qty_positive CHECK (ordered_qty > 0);

ALTER TABLE public.sales_order_items
  DROP CONSTRAINT IF EXISTS soi_unit_price_nonnegative;
ALTER TABLE public.sales_order_items
  ADD CONSTRAINT soi_unit_price_nonnegative CHECK (unit_price >= 0);

ALTER TABLE public.sales_order_items
  DROP CONSTRAINT IF EXISTS soi_ordered_qty_positive;
ALTER TABLE public.sales_order_items
  ADD CONSTRAINT soi_ordered_qty_positive CHECK (ordered_qty > 0);
