-- ============================================
-- 017: Warehouse Ops Completion (Phase 6)
-- PRD refs: §24 (partial transfers), §33 (batches/FEFO),
--           §34 (serials), §35 (blind counts), §38 (notifications)
-- ============================================

-- --------------------------------------------
-- 1. BLIND CYCLE COUNTS (PRD §35)
--    Four-eyes support: who submitted, who reviewed, who approved.
-- --------------------------------------------
ALTER TABLE public.inventory_counts
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- --------------------------------------------
-- 2. PARTIAL TRANSFERS (PRD §24)
--    Per-item shipped_qty/received_qty already exist (migration 004).
--    Header needs to know when the shipping leg is fully done.
-- --------------------------------------------
ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS fully_shipped_at TIMESTAMPTZ;

-- --------------------------------------------
-- 3. BATCHES ↔ LEDGER LINKAGE (PRD §33)
--    Every stock movement can reference the batch it consumed/added,
--    making batch balances reconstructable from the ledger.
-- --------------------------------------------
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inv_tx_batch ON public.inventory_transactions(batch_id);

-- Ledger-derived truth for batch rows (kept in sync by BatchService).
ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS synced_quantity INT NOT NULL DEFAULT 0 CHECK (synced_quantity >= 0);

-- FEFO scan: earliest expiry first, per product/warehouse.
CREATE INDEX IF NOT EXISTS idx_batches_fefo
  ON public.batches(workspace_id, product_id, warehouse_id, expiry_date ASC);

-- batches has no updated_at trigger from migration 004 — add one.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_batches_updated_at ON public.batches;
CREATE TRIGGER trg_batches_updated_at
  BEFORE UPDATE ON public.batches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- --------------------------------------------
-- 4. PERSISTED NOTIFICATIONS (PRD §38)
--    Worker-generated alerts (expiring batches) need durable rows.
--    user_id NULL = workspace-wide notification.
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('expiring_batch', 'low_stock', 'pending_transfer', 'pending_count')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error')),
  reference_type TEXT,
  reference_id TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON public.notifications(workspace_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(workspace_id, read_at);

-- Idempotency for worker-generated expiring-batch alerts:
-- at most ONE notification per batch per workspace per day.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_expiring_batch_daily
  ON public.notifications (workspace_id, reference_id, ((created_at AT TIME ZONE 'utc')::date))
  WHERE type = 'expiring_batch';

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Notification access" ON public.notifications
  FOR ALL USING (public.is_workspace_member(workspace_id));

-- --------------------------------------------
-- 5. SERIALS (PRD §34)
--    serial_numbers table exists (migration 004). Widen the status
--    lifecycle to include in_transit (transfer between warehouses).
-- --------------------------------------------
ALTER TABLE public.serial_numbers DROP CONSTRAINT IF EXISTS serial_numbers_status_check;
ALTER TABLE public.serial_numbers
  ADD CONSTRAINT serial_numbers_status_check
  CHECK (status IN ('available', 'reserved', 'sold', 'returned', 'damaged', 'in_transit'));

-- Faster serial lookup for the FEFO/serial scan paths.
CREATE INDEX IF NOT EXISTS idx_serials_product_status ON public.serial_numbers(product_id, status);

-- Ledger traceability: which stock movement last touched this serial.
ALTER TABLE public.serial_numbers
  ADD COLUMN IF NOT EXISTS last_movement_ref TEXT;
