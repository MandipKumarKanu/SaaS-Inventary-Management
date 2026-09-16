import React, { useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Barcode, Search, Package, Building2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

export function BarcodeScannerPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [code, setCode] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!code.trim() || !activeWorkspace) return;
    setIsLoading(true);
    setError('');
    setLookupResult(null);

    try {
      const res = await api.get(
        `/workspaces/${activeWorkspace.id}/products/lookup?code=${encodeURIComponent(code.trim())}`
      );
      setLookupResult(res.data);
    } catch (err) {
      setError(err.message || `No product found for code "${code}"`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Barcode Scanner & SKU Lookup"
        description="Scan hardware barcode labels or enter SKU strings for instant stock availability breakdown across all warehouses"
      />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex gap-3">
            <div className="relative flex-1">
              <Barcode className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Scan Barcode or type SKU e.g. PROD-1001..."
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="h-11 pl-11 text-base"
                autoFocus
              />
            </div>
            <Button type="submit" disabled={isLoading} className="px-6 text-[15px]">
              <Search /> {isLoading ? 'Searching...' : 'Lookup SKU'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {lookupResult && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Package className="h-7 w-7" />
                </div>
                <div>
                  <h2 className="text-lg font-extrabold">{lookupResult.product?.name}</h2>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge variant="default">SKU: {lookupResult.product?.sku}</Badge>
                    {lookupResult.product?.barcode && (
                      <Badge variant="secondary">UPC: {lookupResult.product?.barcode}</Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-[13px]">
                <div>
                  <span className="block text-muted-foreground">Category</span>
                  <strong>{lookupResult.product?.category?.name || 'Uncategorized'}</strong>
                </div>
                <div>
                  <span className="block text-muted-foreground">Brand</span>
                  <strong>{lookupResult.product?.brand?.name || 'Generic'}</strong>
                </div>
                <div>
                  <span className="block text-muted-foreground">Cost Price</span>
                  <strong>${lookupResult.product?.cost_price}</strong>
                </div>
                <div>
                  <span className="block text-muted-foreground">Selling Price</span>
                  <strong>${lookupResult.product?.selling_price}</strong>
                </div>
              </div>

              <StatCard
                title="Total Stock Across Facilities"
                value={`${lookupResult.totalStock} ${lookupResult.product?.unit || 'pcs'}`}
                icon={Package}
                isLoading={isLoading}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Warehouse Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {lookupResult.stock?.length === 0 ? (
                <div className="px-6 py-6 text-center text-[13px] text-muted-foreground">
                  No active stock recorded for this product in any warehouse.
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {lookupResult.stock?.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3.5"
                    >
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-primary" />
                        <span className="text-sm font-semibold">
                          {item.warehouse?.name} ({item.warehouse?.code})
                        </span>
                      </div>
                      <Badge variant={item.quantity > 0 ? 'success' : 'destructive'}>
                        {item.quantity} units
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
