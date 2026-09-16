import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field, FormSection, FormError } from '@/components/common/FormField';
import { DatePicker } from '@/components/common/DatePicker';

export function CreatePOModal({ isOpen, onClose, onSuccess }) {
  const { activeWorkspace } = useWorkspaceStore();
  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ productId: '', orderedQty: 1, unitCost: 0 }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !activeWorkspace) return;
    async function loadDeps() {
      try {
        const [sRes, wRes, pRes] = await Promise.all([
          api.get(`/workspaces/${activeWorkspace.id}/suppliers`),
          api.get(`/workspaces/${activeWorkspace.id}/warehouses`),
          api.get(`/workspaces/${activeWorkspace.id}/products?pageSize=100`),
        ]);
        setSuppliers(sRes.data || []);
        setWarehouses(wRes.data || []);
        setProducts(pRes.data || []);
        if (sRes.data?.length > 0) setSupplierId(sRes.data[0].id);
        if (wRes.data?.length > 0) setWarehouseId(wRes.data[0].id);
      } catch (err) {
        console.error('Failed to load PO dependencies:', err);
      }
    }
    loadDeps();
  }, [isOpen, activeWorkspace]);

  const handleAddItem = () => {
    setItems([...items, { productId: '', orderedQty: 1, unitCost: 0 }]);
  };

  const handleRemoveItem = (index) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index, field, value) => {
    const next = [...items];
    next[index][field] = value;
    if (field === 'productId') {
      const selected = products.find((p) => p.id === value);
      if (selected) {
        next[index].unitCost = selected.cost_price || 0;
      }
    }
    setItems(next);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const validItems = items.filter((it) => it.productId && it.orderedQty > 0);
    if (validItems.length === 0) {
      setError('Please add at least one line item.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/purchases`, {
        supplierId,
        warehouseId,
        expectedDeliveryDate: expectedDeliveryDate || undefined,
        notes,
        items: validItems.map((it) => ({
          productId: it.productId,
          orderedQty: Number(it.orderedQty),
          unitCost: Number(it.unitCost),
        })),
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create purchase order');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>New Purchase Order</DialogTitle>
          <DialogDescription>Issue an order to a supplier and receive it into a warehouse.</DialogDescription>
        </DialogHeader>

        <FormError error={error} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormSection>
            <Field label="Supplier" required>
              <Select value={supplierId} onValueChange={setSupplierId} required>
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier..." />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Receiving Warehouse" required>
              <Select value={warehouseId} onValueChange={setWarehouseId} required>
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
          </FormSection>

          <FormSection>
            <Field label="Expected Delivery Date">
              <DatePicker
                value={expectedDeliveryDate || undefined}
                onChange={(v) => setExpectedDeliveryDate(v ?? '')}
                placeholder="Pick a delivery date"
              />
            </Field>
            <Field label="Notes">
              <Textarea
                placeholder="Delivery instructions, payment terms..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </FormSection>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">PO Line Items</span>
              <Button type="button" variant="ghost" size="sm" onClick={handleAddItem}>
                <Plus /> Add Item
              </Button>
            </div>

            {items.map((item, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_90px_110px_36px] items-center gap-2"
              >
                <Select
                  value={item.productId}
                  onValueChange={(value) => handleItemChange(idx, 'productId', value)}
                  required
                >
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
                <Input
                  type="number"
                  min="1"
                  value={item.orderedQty}
                  onChange={(e) => handleItemChange(idx, 'orderedQty', e.target.value)}
                  placeholder="Qty"
                  required
                />
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={item.unitCost}
                  onChange={(e) => handleItemChange(idx, 'unitCost', e.target.value)}
                  placeholder="Cost"
                  required
                />
                {items.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove item"
                    onClick={() => handleRemoveItem(idx)}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating PO...' : 'Create Purchase Order'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
