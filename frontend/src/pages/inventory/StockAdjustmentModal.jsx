import React, { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Field, FormError } from '@/components/common/FormField';
import { toast } from '@/components/ui/sonner';

export function StockAdjustmentModal({ onClose, onStockAdjusted }) {
  const { activeWorkspace } = useWorkspaceStore();
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);

  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [qtyChange, setQtyChange] = useState('10');
  const [movementType, setMovementType] = useState('opening_balance');
  const [notes, setNotes] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!activeWorkspace) return;
    async function loadData() {
      try {
        const [prodRes, whRes] = await Promise.all([
          api.get(`/workspaces/${activeWorkspace.id}/products`),
          api.get(`/workspaces/${activeWorkspace.id}/warehouses`),
        ]);
        setProducts(prodRes.data || []);
        setWarehouses(whRes.data || []);

        if (prodRes.data?.[0]) setProductId(prodRes.data[0].id);
        if (whRes.data?.[0]) setWarehouseId(whRes.data[0].id);
      } catch (err) {
        console.error('Failed to load products/warehouses for stock adjustment:', err);
      }
    }
    loadData();
  }, [activeWorkspace]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!productId || !warehouseId || !qtyChange) return;
    setIsLoading(true);
    setError(null);

    try {
      await api.post(`/workspaces/${activeWorkspace.id}/inventory/adjust`, {
        productId,
        warehouseId,
        qtyChange: parseInt(qtyChange, 10),
        movementType,
        notes: notes || undefined,
      });

      toast.success('Stock adjusted successfully');
      if (onStockAdjusted) onStockAdjusted();
      onClose();
    } catch (err) {
      const message = err.message || 'Failed to execute stock adjustment';
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Stock Adjustment</DialogTitle>
          <DialogDescription>Record atomic stock change & append to ledger</DialogDescription>
        </DialogHeader>

        <FormError error={error} />

        <form onSubmit={handleSubmit} className="grid gap-4">
          <Field label="Select Product" required>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Select product..." />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Select Warehouse" required>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="Select warehouse..." />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantity Change (+ / -)" required hint="Positive to add stock, negative to decrease.">
              <Input
                type="number"
                required
                value={qtyChange}
                onChange={(e) => setQtyChange(e.target.value)}
                placeholder="e.g. 50 or -5"
              />
            </Field>

            <Field label="Movement Reason">
              <Select value={movementType} onValueChange={setMovementType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select reason..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opening_balance">Opening Balance</SelectItem>
                  <SelectItem value="adjustment">Stock Count Adjustment</SelectItem>
                  <SelectItem value="purchase_received">Purchase Order Received</SelectItem>
                  <SelectItem value="sales_shipped">Sales Order Shipped</SelectItem>
                  <SelectItem value="transfer_in">Transfer Received</SelectItem>
                  <SelectItem value="transfer_out">Transfer Dispatched</SelectItem>
                  <SelectItem value="return">Customer Return</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Notes / Reason">
            <Input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Initial inventory count after audit"
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <span>Executing...</span>
              ) : (
                <>
                  <Check />
                  <span>Execute Adjustment</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
