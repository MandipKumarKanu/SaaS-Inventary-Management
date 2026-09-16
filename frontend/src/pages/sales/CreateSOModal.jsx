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

export function CreateSOModal({ isOpen, onClose, onSuccess }) {
  const { activeWorkspace } = useWorkspaceStore();
  const [customers, setCustomers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ productId: '', orderedQty: 1, unitPrice: 0 }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !activeWorkspace) return;
    async function loadDeps() {
      try {
        const [cRes, wRes, pRes] = await Promise.all([
          api.get(`/workspaces/${activeWorkspace.id}/customers`),
          api.get(`/workspaces/${activeWorkspace.id}/warehouses`),
          api.get(`/workspaces/${activeWorkspace.id}/products?pageSize=100`),
        ]);
        setCustomers(cRes.data || []);
        setWarehouses(wRes.data || []);
        setProducts(pRes.data || []);
        if (cRes.data?.length > 0) setCustomerId(cRes.data[0].id);
        if (wRes.data?.length > 0) setWarehouseId(wRes.data[0].id);
      } catch (err) {
        console.error('Failed to load SO dependencies:', err);
      }
    }
    loadDeps();
  }, [isOpen, activeWorkspace]);

  const handleAddItem = () => {
    setItems([...items, { productId: '', orderedQty: 1, unitPrice: 0 }]);
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
        next[index].unitPrice = selected.selling_price || 0;
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
      await api.post(`/workspaces/${activeWorkspace.id}/sales`, {
        customerId: customerId || undefined,
        warehouseId,
        shippingAddress,
        notes,
        items: validItems.map((it) => ({
          productId: it.productId,
          orderedQty: Number(it.orderedQty),
          unitPrice: Number(it.unitPrice),
        })),
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create sales order');
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
          <DialogTitle>Create Sales Order</DialogTitle>
          <DialogDescription>Register a customer order for fulfillment from a warehouse.</DialogDescription>
        </DialogHeader>

        <FormError error={error} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormSection>
            <Field label="Customer Account">
              <Select
                value={customerId || 'none'}
                onValueChange={(value) => setCustomerId(value === 'none' ? '' : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select customer..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Walk-in customer (no account)</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fulfillment Warehouse" required>
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
            <Field label="Shipping Address">
              <Input
                type="text"
                placeholder="100 Logistics Way, Suite 5"
                value={shippingAddress}
                onChange={(e) => setShippingAddress(e.target.value)}
              />
            </Field>
            <Field label="Notes">
              <Textarea
                placeholder="Delivery notes, payment terms..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </FormSection>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">SO Line Items</span>
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
                  value={item.unitPrice}
                  onChange={(e) => handleItemChange(idx, 'unitPrice', e.target.value)}
                  placeholder="Price"
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
              {isSubmitting ? 'Creating SO...' : 'Create Sales Order'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
