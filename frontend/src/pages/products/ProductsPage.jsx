import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { CreateProductModal } from './CreateProductModal';
import { Barcode, Package, Plus, Tag, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchFilterBar } from '@/components/common/SearchFilterBar';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PaginationBar } from '@/components/common/PaginationBar';
import { usePagination } from '@/hooks/usePagination';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';

import { useCurrency } from '../../lib/currency';

export function ProductsPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const { symbol, format } = useCurrency();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { page, setPage, pageSize, total, totalPages, resetPage, applyMeta } = usePagination();

  const loadData = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const [prodRes, catRes] = await Promise.all([
        api.get(`/workspaces/${activeWorkspace.id}/products?search=${encodeURIComponent(searchQuery)}&categoryId=${selectedCategory}&page=${page}&pageSize=${pageSize}`),
        api.get(`/workspaces/${activeWorkspace.id}/categories`),
      ]);
      setProducts(prodRes.data || []);
      applyMeta(prodRes.meta);
      setCategories(catRes.data || []);
    } catch (err) {
      console.error('Failed to load products:', err);
      setError(err.message || 'Failed to load products');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeWorkspace, searchQuery, selectedCategory, page]);

  const handleDelete = async (id) => {
    try {
      await api.delete(`/workspaces/${activeWorkspace.id}/products/${id}`);
      loadData();
      toast.success('Product deleted');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products Catalog"
        description={`Manage master product SKUs, pricing, and reorder thresholds for ${activeWorkspace?.name}`}
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus />
            <span>Add Product</span>
          </Button>
        }
      />

      <SearchFilterBar
        searchValue={searchQuery}
        onSearchChange={(v) => { setSearchQuery(v); resetPage(); }}
        searchPlaceholder="Search by name, SKU, or barcode..."
      >
        <Select value={selectedCategory || 'all'} onValueChange={(v) => { setSelectedCategory(v === 'all' ? '' : v); resetPage(); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SearchFilterBar>

      <DataTable
        head={
          <>
            <TableHead>Product Details</TableHead>
            <TableHead>SKU / Barcode</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            <TableHead>Cost / Selling Price</TableHead>
            <TableHead className="hidden md:table-cell">Reorder Point</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </>
        }
        isLoading={isLoading}
        isEmpty={!isLoading && products.length === 0}
        colSpan={6}
        columns={6}
        loadingMessage="Loading product catalog..."
        emptyTitle="No products found"
        emptyDescription='Click "Add Product" to create your first SKU.'
        error={error}
        onRetry={loadData}
        errorTitle="Couldn't load products"
      >
        {products.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Package className="h-[18px] w-[18px]" />
                </div>
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground">Unit: {p.unit}</div>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <code className="w-fit text-xs">{p.sku}</code>
                {p.barcode && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Barcode className="h-2.5 w-2.5" />
                    <span>{p.barcode}</span>
                  </div>
                )}
              </div>
            </TableCell>
            <TableCell className="hidden md:table-cell">
              {p.category ? (
                <Badge variant="secondary" className="normal-case">
                  <Tag className="h-2.5 w-2.5" />
                  <span>{p.category.name}</span>
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">Uncategorized</span>
              )}
            </TableCell>
            <TableCell>
              <div className="text-[13px]">
                <span className="font-bold">{format(p.selling_price)}</span>
                <span className="ml-1.5 text-[11px] text-muted-foreground">(Cost: {format(p.cost_price)})</span>
              </div>
            </TableCell>
            <TableCell className="hidden md:table-cell">
              <Badge variant="warning">
                <span>{p.reorder_point} {p.unit}</span>
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <ConfirmDialog
                title="Delete product?"
                description="This action cannot be undone. The product SKU will be permanently removed."
                confirmLabel="Delete"
                onConfirm={() => handleDelete(p.id)}
                trigger={
                  <Button variant="destructive" size="sm">
                    <Trash2 />
                  </Button>
                }
              />
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />

      {isModalOpen && (
        <CreateProductModal
          onClose={() => setIsModalOpen(false)}
          onProductCreated={loadData}
        />
      )}
    </div>
  );
}
