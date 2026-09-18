import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Plus, Globe } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { PaginationBar } from '@/components/common/PaginationBar';
import { usePagination } from '@/hooks/usePagination';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { toast } from '@/components/ui/sonner';

import { useCurrency } from '../../lib/currency';

export function CurrenciesSettingsPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const { symbol: workspaceSymbol, currencyCode: workspaceCurrencyCode } = useCurrency();
  const [rates, setRates] = useState([]);
  const [currencyCode, setCurrencyCode] = useState('');
  const [symbol, setSymbol] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const { page, setPage, pageSize, total, totalPages, applyMeta } = usePagination();

  const loadRates = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/currencies?page=${page}&pageSize=${pageSize}`);
      setRates(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load currency rates:', err);
      setError(err.message || 'Failed to load currency rates');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRates();
  }, [activeWorkspace, page]);

  const handleAddRate = async (e) => {
    e.preventDefault();
    if (!currencyCode.trim() || !symbol.trim() || !exchangeRate) return;
    setIsSaving(true);
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/currencies`, {
        currencyCode: currencyCode.toUpperCase(),
        symbol,
        exchangeRate: parseFloat(exchangeRate),
      });
      setCurrencyCode('');
      setSymbol('');
      setExchangeRate('');
      loadRates();
    } catch (err) {
      toast.error(err.message || 'Failed to add exchange rate');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Multi-Currency Exchange Rates"
        description="Manage global exchange rates and primary currency symbols for international valuation & purchase orders"
      />

      <Card>
        <CardHeader>
          <CardTitle>Add / Update Exchange Rate</CardTitle>
          <CardDescription>Rates are relative to the {workspaceCurrencyCode} base currency.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddRate} className="grid items-center gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
            <Input
              type="text"
              placeholder="ISO Code (e.g. EUR, GBP, JPY)"
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value)}
              required
              maxLength={5}
            />
            <Input
              type="text"
              placeholder="Symbol (e.g. €, £, ¥)"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              required
              maxLength={5}
            />
            <Input
              type="number"
              step="0.0001"
              placeholder={`Rate relative to base (${workspaceCurrencyCode})`}
              value={exchangeRate}
              onChange={(e) => setExchangeRate(e.target.value)}
              required
            />
            <Button type="submit" disabled={isSaving}>
              <Plus className="h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Rate'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <DataTable
          head={
            <>
              <TableHead>Currency Code</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Exchange Rate (Base 1.00 {workspaceCurrencyCode})</TableHead>
              <TableHead>Last Updated</TableHead>
            </>
          }
          isLoading={isLoading}
          isEmpty={false}
          error={error}
          onRetry={loadRates}
          errorTitle="Couldn't load currency rates"
          colSpan={4}
          columns={4}
        >
          <TableRow>
            <TableCell className="font-bold">
              <span className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                {workspaceCurrencyCode} (Default Base)
              </span>
            </TableCell>
            <TableCell className="font-bold">{workspaceSymbol}</TableCell>
            <TableCell className="font-mono">1.0000</TableCell>
            <TableCell className="text-[13px] text-muted-foreground">System Default</TableCell>
          </TableRow>
          {rates.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-bold">{r.currency_code}</TableCell>
              <TableCell className="font-bold">{r.symbol}</TableCell>
              <TableCell className="font-mono text-success">{Number(r.exchange_rate).toFixed(4)}</TableCell>
              <TableCell className="text-[13px] text-muted-foreground">
                {new Date(r.updated_at).toLocaleDateString()}
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      </Card>

      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
