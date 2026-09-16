import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';

export function DemandForecastPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [forecasts, setForecasts] = useState([]);
  const [days, setDays] = useState(30);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadForecast = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/analytics/forecast?days=${days}`);
      setForecasts(res.data || []);
    } catch (err) {
      console.error('Failed to load forecast:', err);
      setError(err.message || 'Failed to load forecast');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadForecast();
  }, [activeWorkspace, days]);

  const getRiskBadge = (risk) => {
    switch (risk) {
      case 'CRITICAL_STOCKOUT':
        return (
          <StatusBadge variant="destructive">
            <AlertTriangle className="h-3 w-3" /> Out of Stock
          </StatusBadge>
        );
      case 'HIGH_RISK':
        return (
          <StatusBadge variant="warning">
            <Clock className="h-3 w-3" /> Stockout Risk ({'<'} 7 Days)
          </StatusBadge>
        );
      case 'MODERATE_RISK':
        return <StatusBadge variant="default">{'<'} 30 Days Stock</StatusBadge>;
      default:
        return (
          <StatusBadge variant="success">
            <CheckCircle2 className="h-3 w-3" /> Healthy
          </StatusBadge>
        );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Predictive Demand Forecasting & Stockout Risk"
        description="Historical sales velocity run-rate calculations and projected stockout depletion trajectories"
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="analysis-period">Analysis Period:</Label>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger id="analysis-period" className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 Days</SelectItem>
                <SelectItem value="30">30 Days</SelectItem>
                <SelectItem value="90">90 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      <Card>
        <CardContent className="pt-6">
          <DataTable
            head={
              <>
                <TableHead>Product / SKU</TableHead>
                <TableHead>Current Stock</TableHead>
                <TableHead>Sales ({days}D)</TableHead>
                <TableHead>Daily Demand Rate</TableHead>
                <TableHead>Est. Days to Stockout</TableHead>
                <TableHead>Projected Stockout Date</TableHead>
                <TableHead>Risk Status</TableHead>
              </>
            }
            isLoading={isLoading}
            isEmpty={!isLoading && forecasts.length === 0}
            error={error}
            onRetry={loadForecast}
            errorTitle="Couldn't load demand forecast"
            colSpan={7}
            columns={7}
            loadingMessage="Calculating demand run-rate forecasts..."
            emptyTitle="No product demand data available."
          >
            {forecasts.map((f) => (
              <TableRow key={f.product.id}>
                <TableCell>
                  <span className="font-bold">{f.product.name}</span>{' '}
                  <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">
                    {f.product.sku}
                  </span>
                </TableCell>
                <TableCell
                  className={
                    f.currentStock === 0 ? 'font-extrabold text-destructive' : 'font-extrabold'
                  }
                >
                  {f.currentStock} {f.product.unit || 'pcs'}
                </TableCell>
                <TableCell className="font-semibold">{f.totalUnitsSold} units</TableCell>
                <TableCell className="font-bold text-primary">
                  {f.dailyDemandRate} units/day
                </TableCell>
                <TableCell
                  className={
                    f.daysUntilStockout !== null && f.daysUntilStockout <= 7
                      ? 'font-bold text-destructive'
                      : 'font-bold'
                  }
                >
                  {f.daysUntilStockout !== null
                    ? `${f.daysUntilStockout} days`
                    : 'N/A (No Demand)'}
                </TableCell>
                <TableCell className="text-[13px] text-muted-foreground">
                  {f.projectedStockoutDate || 'Stable'}
                </TableCell>
                <TableCell>{getRiskBadge(f.riskLevel)}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>
    </div>
  );
}
