-- ============================================
-- 012: Inventory Transaction Safety (Phase 2)
--   - Immutable ledger & audit at the DB level (PRD §20, §41, Rule #4)
--   - Expanded movement types (PRD §20)
--   - Idempotency keys for retry-safe operations (PRD §24)
--   - Data integrity CHECK constraints (PRD §46)
-- ============================================

-- 1. EXPANDED MOVEMENT TYPES (PRD §20)
ALTER TABLE public.inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_movement_type_check;

ALTER TABLE public.inventory_transactions
  ADD CONSTRAINT inventory_transactions_movement_type_check
  CHECK (movement_type IN (
    'opening_balance', 'adjustment', 'purchase_received', 'sales_shipped',
    'transfer_in', 'transfer_out', 'return', 'customer_return',
    'damaged', 'expired', 'stock_count_correction'
  ));

-- 2. IDEMPOTENCY KEY (retry-safe stock operations, PRD §24)
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Unique per workspace so two workers can never double-apply the same movement.
-- Partial index: only rows that carry a key participate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_tx_idempotency
  ON public.inventory_transactions(workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3. DATA INTEGRITY CHECKS (PRD §46)
-- Ledger chain must be internally consistent
ALTER TABLE public.inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_qty_chain_check;
ALTER TABLE public.inventory_transactions
  ADD CONSTRAINT inventory_transactions_qty_chain_check
  CHECK (qty_after = qty_before + qty_change);

-- Prefer partial indexes over extra CHECKs for the NULL-barcode case
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_workspace_barcode
  ON public.products(workspace_id, barcode)
  WHERE barcode IS NOT NULL;

-- 4. IMMUTABILITY: LEDGER + AUDIT (PRD §20/§41/Rule #4/#10)
-- supabaseAdmin uses the service role, which bypasses RLS — so immutability
-- must be enforced by triggers + privileges, not RLS alone.

CREATE OR REPLACE FUNCTION public.prevent_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'inventory_transactions is append-only (immutable ledger)';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_ledger_mutation_trigger ON public.inventory_transactions;
CREATE TRIGGER prevent_ledger_mutation_trigger
  BEFORE UPDATE OR DELETE ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();

CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (immutable audit trail)';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_audit_mutation_trigger ON public.audit_logs;
CREATE TRIGGER prevent_audit_mutation_trigger
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();

-- 5. HELPFUL INDEXES FOR LEDGER QUERIES
CREATE INDEX IF NOT EXISTS idx_inv_tx_reference
  ON public.inventory_transactions(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_inv_tx_idempotency_lookup
  ON public.inventory_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
