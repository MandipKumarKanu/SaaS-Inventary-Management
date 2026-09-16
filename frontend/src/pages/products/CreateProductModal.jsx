import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormError } from '@/components/common/FormField';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';

export function CreateProductModal({ onClose, onProductCreated }) {
  const { activeWorkspace } = useWorkspaceStore();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [costPrice, setCostPrice] = useState('0.00');
  const [sellingPrice, setSellingPrice] = useState('0.00');
  const [reorderPoint, setReorderPoint] = useState('10');
  const [minStock, setMinStock] = useState('0');
  const [description, setDescription] = useState('');

  const [categories, setCategories] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!activeWorkspace) return;
    async function loadData() {
      try {
        const res = await api.get(`/workspaces/${activeWorkspace.id}/categories`);
        setCategories(res.data || []);
      } catch (err) {
        console.error('Failed to load categories:', err);
      }
    }
    loadData();
  }, [activeWorkspace]);

  const handleNameChange = (e) => {
    const val = e.target.value;
    setName(val);
    if (!sku) {
      setSku('SKU-' + val.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 10));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !sku) return;
    setIsLoading(true);
    setError(null);

    try {
      await api.post(`/workspaces/${activeWorkspace.id}/products`, {
        name,
        sku,
        barcode: barcode || undefined,
        categoryId: categoryId || undefined,
        unit,
        costPrice: parseFloat(costPrice) || 0,
        sellingPrice: parseFloat(sellingPrice) || 0,
        reorderPoint: parseInt(reorderPoint, 10) || 10,
        minStock: parseInt(minStock, 10) || 0,
        description: description || undefined,
      });

      if (onProductCreated) onProductCreated();
      toast.success('Product created');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Add Product</DialogTitle>
          <DialogDescription>Create new SKU in {activeWorkspace?.name}</DialogDescription>
        </DialogHeader>

        <FormError error={error} />

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Product Name" htmlFor="product-name" required className="sm:col-span-2">
            <Input
              id="product-name"
              type="text"
              required
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Wireless Ergonomic Mouse"
            />
          </Field>

          <Field label="SKU (Unique)" htmlFor="product-sku" required>
            <Input
              id="product-sku"
              type="text"
              required
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="SKU-MOUSE-01"
            />
          </Field>

          <Field label="Barcode (UPC/EAN)" htmlFor="product-barcode">
            <Input
              id="product-barcode"
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="8901234567890"
            />
          </Field>

          <Field label="Category" htmlFor="product-category">
            <Select value={categoryId || 'uncategorized'} onValueChange={(v) => setCategoryId(v === 'uncategorized' ? '' : v)}>
              <SelectTrigger id="product-category">
                <SelectValue placeholder="Uncategorized" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="uncategorized">Uncategorized</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Unit of Measure" htmlFor="product-unit">
            <Input
              id="product-unit"
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="pcs / kg / box"
            />
          </Field>

          <Field label="Cost Price ($)" htmlFor="product-cost">
            <Input
              id="product-cost"
              type="number"
              step="0.01"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
            />
          </Field>

          <Field label="Selling Price ($)" htmlFor="product-price">
            <Input
              id="product-price"
              type="number"
              step="0.01"
              value={sellingPrice}
              onChange={(e) => setSellingPrice(e.target.value)}
            />
          </Field>

          <Field label="Reorder Point" htmlFor="product-reorder">
            <Input
              id="product-reorder"
              type="number"
              value={reorderPoint}
              onChange={(e) => setReorderPoint(e.target.value)}
            />
          </Field>

          <Field label="Minimum Stock" htmlFor="product-minstock">
            <Input
              id="product-minstock"
              type="number"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
            />
          </Field>

          <Field label="Description (Optional)" htmlFor="product-description" className="sm:col-span-2">
            <Input
              id="product-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Product specification or notes"
            />
          </Field>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>{isLoading ? 'Creating...' : 'Create Product'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
