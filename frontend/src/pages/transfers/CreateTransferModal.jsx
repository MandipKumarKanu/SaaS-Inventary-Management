import React, { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Plus, Trash2, ArrowRight } from 'lucide-react';
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

export function CreateTransferModal({ isOpen, onClose, onSuccess }) {
  const { activeWorkspace } = useWorkspaceStore();
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ productId: '', requestedQty: 1 }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !activeWorkspace) return;
    async function loadData() {
      try {
        const [wRes, pRes] = await Promise.all([
          api.get(`/workspaces/${activeWorkspace.id}/warehouses`),
          api.get(`/workspaces/${activeWorkspace.id}/products?pageSize=100`),
        ]);
        setWarehouses(wRes.data || []);
        setProducts(pRes.data || []);
        if (wRes.data?.length >= 2) {
          setSourceWarehouseId(wRes.data[0].id);
          setDestinationWarehouseId(wRes.data[1].id);
        } else if (wRes.data?.length === 1) {
          setSourceWarehouseId(wRes.data[0].id);
        }
      } catch (err) {
        console.error('Failed to load transfer modal dependencies:', err);
      }
    }
    loadData();
  }, [isOpen, activeWorkspace]);

  const handleAddItem = () => {
    setItems([...items, { productId: '', requestedQty: 1 }]);
  };

  const handleRemoveItem = (index) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index, field, value) => {
    const next = [...items];
    next[index][field] = value;
    setItems(next);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (sourceWarehouseId === destinationWarehouseId) {
      setError('Source and Destination warehouses must be different.');
      return;
    }

    const validItems = items.filter((it) => it.productId && it.requestedQty > 0);
    if (validItems.length === 0) {
      setError('Please select at least one valid product to transfer.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/transfers`, {
        sourceWarehouseId,
        destinationWarehouseId,
        notes,
        items: validItems.map((it) => ({
          productId: it.productId,
          requestedQty: Number(it.requestedQty),
        })),
      });
      toast.success('Transfer request created');
      onSuccess();
      onClose();
    } catch (err) {
      const message = err.message || 'Failed to create transfer request';
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>New Stock Transfer Request</DialogTitle>
          <DialogDescription>Request stock movement between warehouses</DialogDescription>
        </DialogHeader>

        <FormError error={error} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <Field label="Source Warehouse">
              <Select value={sourceWarehouseId} onValueChange={setSourceWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Source" />
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

            <div className="flex justify-center pb-2 text-muted-foreground">
              <ArrowRight className="h-5 w-5" />
            </div>

            <Field label="Destination Warehouse">
              <Select value={destinationWarehouseId} onValueChange={setDestinationWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Destination" />
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
          </div>

          <Field label="Notes / Instructions">
            <Input
              type="text"
              placeholder="e.g. Replenish retail floor stock"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-semibold">Transfer Items</span>
              <Button type="button" variant="ghost" size="sm" onClick={handleAddItem}>
                <Plus /> Add Item
              </Button>
            </div>

            <div className="flex flex-col gap-2.5">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_100px_32px] items-center gap-2.5">
                  <Select
                    value={item.productId}
                    onValueChange={(v) => handleItemChange(idx, 'productId', v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Product..." />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    type="number"
                    min="1"
                    value={item.requestedQty}
                    onChange={(e) => handleItemChange(idx, 'requestedQty', e.target.value)}
                    placeholder="Qty"
                    required
                  />

                  {items.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRemoveItem(idx)}
                      className="text-destructive"
                      aria-label="Remove item"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Transfer Request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
