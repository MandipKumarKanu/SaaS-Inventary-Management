-- ============================================
-- 020: Goods Receipts (Phase 8, PRD §45)
-- A PO receipt becomes a stored, auditable DOCUMENT (who, when, what
-- quantities, which serials) instead of only mutating received_qty.
-- Stock/serial mutations stay in PurchaseService.receiveItems; the receipt
-- is written INSIDE the same transaction (rollback-safe).
-- ============================================

CREATE TABLE IF NOT EXISTS public.goods_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  grn_number TEXT NOT NULL,
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  po_number TEXT NOT NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  received_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (workspace_id, grn_number)
);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_ws_created
  ON public.goods_receipts (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_po
  ON public.goods_receipts (purchase_order_id);

CREATE TABLE IF NOT EXISTS public.goods_receipt_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id UUID NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  po_item_id UUID REFERENCES public.purchase_order_items(id) ON DELETE SET NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty_received INTEGER NOT NULL CHECK (qty_received > 0),
  -- Serial numbers registered by this receipt leg (PRD §34) — snapshot for
  -- the printable document; serial_numbers remains the live registry.
  serials_registered JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_receipt
  ON public.goods_receipt_items (receipt_id);

-- ============================================
-- GRN document numbering: next_document_number() (migration 014) INSERTs a
-- sequence row ON CONFLICT on first use — new doc types like 'GRN' need no
-- seeding or triggers. First call yields GRN-<year>-000001.
-- ============================================

-- ============================================
-- RLS: workspace members can read receipts; service role (backend) bypasses.
-- ============================================
ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS goods_receipts_select ON public.goods_receipts;
CREATE POLICY goods_receipts_select ON public.goods_receipts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = goods_receipts.workspace_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

DROP POLICY IF EXISTS goods_receipt_items_select ON public.goods_receipt_items;
CREATE POLICY goods_receipt_items_select ON public.goods_receipt_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.goods_receipts g
      JOIN public.workspace_members m ON m.workspace_id = g.workspace_id
      WHERE g.id = goods_receipt_items.receipt_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );
