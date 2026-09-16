-- ============================================
-- 018: Reservations & Fulfillment (Phase 7)
-- PRD refs: §30 (reservation model), §31 (fulfillment suggestion),
--           Rule "do not deduct inventory merely because a sales order exists"
-- ============================================

-- --------------------------------------------
-- 1. INVENTORY RESERVATIONS
--    One active reservation per SO item lifetime (UNIQUE constraint).
--    reserve → active; cancel → released; ship → converted.
--    Invariant: SUM(active.quantity) per (product, warehouse) MUST equal
--    inventory.reserved_quantity — enforced by service transactions and
--    asserted in tests.
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  sales_order_id UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  sales_order_item_id UUID NOT NULL REFERENCES public.sales_order_items(id) ON DELETE CASCADE,
  quantity INT NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'converted')),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  released_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,                     -- policy hook for a future sweeper (Phase 10)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sales_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_reservations_lookup
  ON public.inventory_reservations (workspace_id, product_id, warehouse_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_so
  ON public.inventory_reservations (sales_order_id);

ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Reservation access" ON public.inventory_reservations
  FOR ALL USING (public.is_workspace_member(workspace_id));

-- --------------------------------------------
-- 2. GUARD: never reserve more than is on hand.
--    reserved_quantity <= quantity at the DB level — a service bug or a
--    manual UPDATE cannot oversell stock that isn't there.
-- --------------------------------------------
ALTER TABLE public.inventory
  DROP CONSTRAINT IF EXISTS inventory_reserved_lte_quantity;
ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_reserved_lte_quantity CHECK (reserved_quantity <= quantity);
