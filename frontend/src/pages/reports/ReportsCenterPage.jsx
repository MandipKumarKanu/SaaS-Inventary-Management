import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Download, DollarSign, Package, Warehouse, Activity } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { LoadingState } from '@/components/common/DataTable';
import { ErrorState } from '@/components/common/ErrorState';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export function ReportsCenterPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [report, setReport] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadReport = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/analytics/executive-report`);
      setReport(res.data);
    } catch (err) {
      console.error('Failed to load executive report:', err);
      setError(err.message || 'Failed to load executive report');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [activeWorkspace]);

  const handleExportCSV = () => {
    if (!report) return;
    const csvRows = [
      ['Metric', 'Value'],
      ['Total Inventory Valuation ($)', report.totalValuation],
      ['Total SKU Count', report.totalSKUs],
      ['Class A SKUs', report.classASKUs],
      ['Class B SKUs', report.classBSKUs],
      ['Class C SKUs', report.classCSKUs],
      ['Stockout Risk Products', report.highRiskStockouts],
      ['Active Storage Facilities', report.warehousesCount],
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + csvRows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Executive_Inventory_Report_${activeWorkspace?.slug}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Executive Reports & Analytics Center"
        description="Consolidated operational reports, inventory asset valuation, and stock velocity export"
        actions={
          <Button onClick={handleExportCSV}>
            <Download /> Export CSV Report
          </Button>
        }
      />

      {isLoading ? (
        <LoadingState message="Generating executive report..." />
      ) : error ? (
        <ErrorState description={error} onRetry={loadReport} />
      ) : (
        <Tabs defaultValue="overview" className="w-full">
          <TabsList>
            <TabsTrigger value="overview">Key Metrics</TabsTrigger>
            <TabsTrigger value="movements">Stock Movements</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="Total Asset Valuation"
                value={`$${report?.totalValuation?.toLocaleString()}`}
                icon={DollarSign}
              />
              <StatCard
                title="Master SKU Catalog"
                value={`${report?.totalSKUs} SKUs`}
                icon={Package}
              />
              <StatCard
                title="Stockout Risks"
                value={`${report?.highRiskStockouts} Items`}
                icon={Activity}
              />
              <StatCard
                title="Storage Facilities"
                value={`${report?.warehousesCount} Facilities`}
                icon={Warehouse}
              />
            </div>
          </TabsContent>

          <TabsContent value="movements">
            <Card>
              <CardHeader>
                <CardTitle>Historical Stock Movement Summary</CardTitle>
                <CardDescription>Aggregated movement quantities by transaction type</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(report?.movementSummary || {}).map(([type, totalQty]) => (
                    <div
                      key={type}
                      className="rounded-lg border border-border bg-muted/50 p-3.5"
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {type.replace('_', ' ')}
                      </div>
                      <div className="mt-1 text-lg font-extrabold">{totalQty} units</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
