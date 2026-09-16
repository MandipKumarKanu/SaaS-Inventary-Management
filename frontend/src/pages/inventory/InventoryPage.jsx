import React, { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { StockAdjustmentModal } from './StockAdjustmentModal';
import { SlidersHorizontal, Warehouse, Package } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchFilterBar } from '@/components/common/SearchFilterBar';
import { DataTable } from '@/components/common/DataTable';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';

export function InventoryPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [inventory, setInventory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const loadStockLevels = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/inventory`);
      setInventory(res.data || []);
    } catch (err) {
      console.error('Failed to load inventory stock levels:', err);
      setError(err.message || 'Failed to load inventory stock levels');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStockLevels();
  }, [activeWorkspace]);

  const query = searchValue.trim().toLowerCase();
  const filtered = query
    ? inventory.filter((inv) =>
        [inv.product?.name, inv.product?.sku, inv.warehouse?.name, inv.warehouse?.code]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(query))
      )
    : inventory;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventory Stock Balances"
        description={`Realtime on-hand balances across storage locations for ${activeWorkspace?.name}`}
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <SlidersHorizontal />
            <span>Adjust Stock</span>
          </Button>
        }
      />

      <SearchFilterBar
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchPlaceholder="Search product, SKU, warehouse…"
      />

      <DataTable
        head={
          <>
            <TableHead>Product Details</TableHead>
            <TableHead>Warehouse Facility</TableHead>
            <TableHead>On-Hand Quantity</TableHead>
            <TableHead>Reserved Qty</TableHead>
            <TableHead>Available Qty</TableHead>
            <TableHead>Stock Status</TableHead>
          </>
        }
        isLoading={isLoading}
        isEmpty={!isLoading && filtered.length === 0}
        colSpan={6}
        columns={6}
        loadingMessage="Loading stock balances..."
        emptyTitle="No inventory balances recorded yet"
        emptyDescription="Perform a stock adjustment to add opening stock."
        error={error}
        onRetry={loadStockLevels}
        errorTitle="Couldn't load inventory"
      >
        {filtered.map((inv) => {
          const available = inv.quantity - inv.reserved_quantity;
          const reorder = inv.product?.reorder_point || 10;
          const isLow = available <= reorder;

          return (
            <TableRow key={inv.id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Package className="h-[18px] w-[18px] text-primary" />
                  <div>
                    <div className="font-semibold">{inv.product?.name || 'Product'}</div>
                    <code className="text-xs text-muted-foreground">{inv.product?.sku}</code>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Warehouse className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[13px] font-medium">{inv.warehouse?.name}</span>
                  <code className="text-xs text-muted-foreground">({inv.warehouse?.code})</code>
                </div>
              </TableCell>
              <TableCell className="text-[15px] font-bold">
                {inv.quantity} {inv.product?.unit || 'pcs'}
              </TableCell>
              <TableCell className="text-[13px] text-muted-foreground">{inv.reserved_quantity}</TableCell>
              <TableCell
                className={`text-[15px] font-bold ${available > 0 ? 'text-success' : 'text-destructive'}`}
              >
                {available}
              </TableCell>
              <TableCell>
                {isLow ? (
                  <StatusBadge status="low_stock">Low Stock</StatusBadge>
                ) : (
                  <StatusBadge status="in_stock">Optimal</StatusBadge>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>

      {isModalOpen && (
        <StockAdjustmentModal onClose={() => setIsModalOpen(false)} onStockAdjusted={loadStockLevels} />
      )}
    </div>
  );
}
