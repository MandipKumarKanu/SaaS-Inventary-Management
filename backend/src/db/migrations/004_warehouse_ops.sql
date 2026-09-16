-- ============================================
-- Phase 3: Warehouse Operations Migration
-- Tables: stock_transfers, stock_transfer_items, batches,
--          serial_numbers, inventory_counts, inventory_count_items
-- ============================================

-- 1. STOCK TRANSFERS (Header)
CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  transfer_number TEXT NOT NULL,
  source_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  destination_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('draft', 'requested', 'approved', 'shipped', 'in_transit', 'received', 'completed', 'cancelled')),
  notes TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  shipped_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, transfer_number)
);

CREATE INDEX IF NOT EXISTS idx_transfers_workspace ON public.stock_transfers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON public.stock_transfers(status);

-- 2. STOCK TRANSFER ITEMS
CREATE TABLE IF NOT EXISTS public.stock_transfer_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_id UUID NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  requested_qty INT NOT NULL CHECK (requested_qty > 0),
  shipped_qty INT NOT NULL DEFAULT 0 CHECK (shipped_qty >= 0),
  received_qty INT NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer ON public.stock_transfer_items(transfer_id);

-- 3. BATCHES / LOTS (FEFO & Expiry Tracking)
CREATE TABLE IF NOT EXISTS public.batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  batch_number TEXT NOT NULL,
  mfg_date DATE,
  expiry_date DATE,
  quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, product_id, warehouse_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_batches_workspace ON public.batches(workspace_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON public.batches(expiry_date ASC);

-- 4. SERIAL NUMBERS
CREATE TABLE IF NOT EXISTS public.serial_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  serial_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'sold', 'returned', 'damaged')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, product_id, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_serials_workspace ON public.serial_numbers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_serials_status ON public.serial_numbers(status);

-- 5. INVENTORY COUNTS (Cycle Counting Header)
CREATE TABLE IF NOT EXISTS public.inventory_counts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  count_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('draft', 'in_progress', 'review', 'completed', 'cancelled')),
  notes TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, count_number)
);

CREATE INDEX IF NOT EXISTS idx_counts_workspace ON public.inventory_counts(workspace_id);

-- 6. INVENTORY COUNT ITEMS (System vs Physical Variance)
CREATE TABLE IF NOT EXISTS public.inventory_count_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  count_id UUID NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  system_qty INT NOT NULL DEFAULT 0,
  physical_qty INT,
  variance_qty INT GENERATED ALWAYS AS (COALESCE(physical_qty, system_qty) - system_qty) STORED,
  approved BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_count_items_count ON public.inventory_count_items(count_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.serial_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Transfer header access" ON public.stock_transfers FOR ALL USING (public.is_workspace_member(workspace_id));
CREATE POLICY "Batch access" ON public.batches FOR ALL USING (public.is_workspace_member(workspace_id));
CREATE POLICY "Serial access" ON public.serial_numbers FOR ALL USING (public.is_workspace_member(workspace_id));
CREATE POLICY "Count header access" ON public.inventory_counts FOR ALL USING (public.is_workspace_member(workspace_id));
