import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Package, Warehouse, ShoppingCart, ShoppingBag, Truck } from 'lucide-react';

export function GlobalSearchModal({ isOpen, onClose }) {
  const { activeWorkspace } = useWorkspaceStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) setQuery('');
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim() || !activeWorkspace) {
      setResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await api.get(`/workspaces/${activeWorkspace.id}/search?q=${encodeURIComponent(query)}`);
        setResults(res.data || null);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, activeWorkspace]);

  const select = (path) => {
    const slug = activeWorkspace?.slug;
    const target = slug && !path.startsWith('/app/') ? `/app/${slug}${path}` : path;
    navigate(target);
    onClose();
  };

  return (
    <CommandDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <CommandInput
        placeholder="Type SKU, product name, warehouse, order #, or supplier…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {isLoading && <div className="py-6 text-center text-sm text-muted-foreground">Searching workspace…</div>}
        {!isLoading && query.trim() && !results && (
          <CommandEmpty>No matching records found for “{query}”.</CommandEmpty>
        )}
        {!isLoading && !query.trim() && (
          <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
            Press <strong>⌘K</strong> or <strong>Ctrl+K</strong> anytime to open search
          </div>
        )}
        {results?.products?.length > 0 && (
          <CommandGroup heading="Products">
            {results.products.map((p) => (
              <CommandItem key={p.id} value={`product-${p.id}-${p.name}`} onSelect={() => select('/products')}>
                <Package className="h-4 w-4 text-primary" />
                <span className="font-medium">{p.name}</span>
                <span className="ml-auto font-mono text-xs text-primary">{p.sku}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results?.warehouses?.length > 0 && (
          <CommandGroup heading="Warehouses">
            {results.warehouses.map((w) => (
              <CommandItem key={w.id} value={`warehouse-${w.id}-${w.name}`} onSelect={() => select('/warehouses')}>
                <Warehouse className="h-4 w-4 text-warning" />
                <span className="font-medium">{w.name}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{w.code}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results?.sales_orders?.length > 0 && (
          <CommandGroup heading="Sales orders">
            {results.sales_orders.map((so) => (
              <CommandItem key={so.id} value={`so-${so.id}-${so.order_number}`} onSelect={() => select(`/sales/${so.id}`)}>
                <ShoppingCart className="h-4 w-4 text-success" />
                <span className="font-medium">{so.order_number}</span>
                <span className="ml-auto text-xs font-bold text-success">${Number(so.total_amount).toFixed(2)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results?.purchase_orders?.length > 0 && (
          <CommandGroup heading="Purchase orders">
            {results.purchase_orders.map((po) => (
              <CommandItem key={po.id} value={`po-${po.id}-${po.order_number}`} onSelect={() => select(`/purchases/${po.id}`)}>
                <ShoppingBag className="h-4 w-4 text-primary" />
                <span className="font-medium">{po.order_number}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results?.suppliers?.length > 0 && (
          <CommandGroup heading="Suppliers">
            {results.suppliers.map((s) => (
              <CommandItem key={s.id} value={`supplier-${s.id}-${s.name}`} onSelect={() => select('/suppliers')}>
                <Truck className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{s.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
