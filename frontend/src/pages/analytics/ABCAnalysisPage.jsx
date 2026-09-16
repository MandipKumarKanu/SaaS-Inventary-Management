import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Layers, Package, Boxes } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { DataTable, LoadingState } from '@/components/common/DataTable';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';

export function ABCAnalysisPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/analytics/abc`);
      setData(res.data);
    } catch (err) {
      console.error('Failed to load ABC analysis:', err);
      setError(err.message || 'Failed to load ABC analysis');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeWorkspace]);

  if (isLoading && !error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="ABC Inventory Classification"
          description="Categorize SKUs by cumulative asset value contribution (Class A: Top 70%, Class B: Next 20%, Class C: Remaining 10%)"
        />
        <LoadingState message="Calculating ABC inventory classification..." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="ABC Inventory Classification"
        description="Categorize SKUs by cumulative asset value contribution (Class A: Top 70%, Class B: Next 20%, Class C: Remaining 10%)"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Class A (High Value / High Control)"
          value={`${data?.classA?.length || 0} SKUs`}
          icon={Layers}
          badge="70% Value"
        />
        <StatCard
          title="Class B (Medium Value)"
          value={`${data?.classB?.length || 0} SKUs`}
          icon={Package}
          badge="20% Value"
        />
        <StatCard
          title="Class C (Low Value / High Volume)"
          value={`${data?.classC?.length || 0} SKUs`}
          icon={Boxes}
          badge="10% Value"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Class A Products (Priority Control)</CardTitle>
            <CardDescription>Tight inventory control and frequent cycle counts</CardDescription>
          </div>
          <Badge variant="secondary">
            Total Asset Valuation: ${data?.totalValuation?.toLocaleString()}
          </Badge>
        </CardHeader>
        <CardContent>
          <DataTable
            head={
              <>
                <TableHead>Product / SKU</TableHead>
                <TableHead>Current Stock</TableHead>
                <TableHead>Unit Cost</TableHead>
                <TableHead>Asset Valuation</TableHead>
                <TableHead>Cumulative %</TableHead>
                <TableHead>Policy Recommendation</TableHead>
              </>
            }
            isEmpty={!data?.classA || data.classA.length === 0}
            error={error}
            onRetry={loadData}
            errorTitle="Couldn't load ABC analysis"
            colSpan={6}
            columns={6}
            emptyTitle="No Class A items found."
          >
            {data?.classA?.map((item) => (
              <TableRow key={item.product.id}>
                <TableCell>
                  <span className="font-bold">{item.product.name}</span>{' '}
                  <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">
                    {item.product.sku}
                  </span>
                </TableCell>
                <TableCell className="font-bold">{item.currentQty}</TableCell>
                <TableCell className="text-muted-foreground">${item.costPrice}</TableCell>
                <TableCell className="font-extrabold text-success">
                  ${item.assetValue.toLocaleString()}
                </TableCell>
                <TableCell className="font-bold text-primary">{item.cumulativePct}%</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {item.policyRecommendation}
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>
    </div>
  );
}
