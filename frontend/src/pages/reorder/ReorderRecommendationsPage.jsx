import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { AlertOctagon, ShoppingBag, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchFilterBar } from '@/components/common/SearchFilterBar';
import { DataTable } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { StatCard } from '@/components/common/StatCard';
import { Button } from '@/components/ui/button';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePagination } from '@/hooks/usePagination';
import { PaginationBar } from '@/components/common/PaginationBar';

function urgencyBadge(urgency) {
  switch (urgency) {
    case 'CRITICAL':
      return (
        <StatusBadge status={urgency} variant="destructive">
          <AlertOctagon className="h-3 w-3" /> Stockout Risk
        </StatusBadge>
      );
    case 'HIGH':
      return (
        <StatusBadge status={urgency} variant="warning">
          <ShieldAlert className="h-3 w-3" /> Urgent Reorder
        </StatusBadge>
      );
    default:
      return <StatusBadge status={urgency}>Reorder Point Reached</StatusBadge>;
  }
}

export function ReorderRecommendationsPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const navigate = useNavigate();
  const [recommendations, setRecommendations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [summary, setSummary] = useState(null);
  const { page, setPage, pageSize, total, totalPages, resetPage, applyMeta } = usePagination();

  const loadRecommendations = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(
        `/workspaces/${activeWorkspace.id}/reorder?page=${page}&pageSize=${pageSize}&urgency=${urgencyFilter}`
      );
      setRecommendations(res.data || []);
      applyMeta(res.meta);
      setSummary(res.meta?.summary || null);
    } catch (err) {
      console.error('Failed to load reorder recommendations:', err);
      setError(err.message || 'Failed to load reorder recommendations');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRecommendations();
  }, [activeWorkspace, page, urgencyFilter]);

  // Server filters by urgency; search stays client-side over the loaded page
  // (the endpoint has no text-search param).
  const filteredRecommendations = recommendations.filter((rec) => {
    const query = searchQuery.trim().toLowerCase();
    return (
      !query ||
      rec.product?.name?.toLowerCase().includes(query) ||
      rec.product?.sku?.toLowerCase().includes(query)
    );
  });

  const criticalCount = summary?.criticalCount ?? recommendations.filter((rec) => rec.urgency === 'CRITICAL').length;
  const suggestedTotal =
    summary?.suggestedTotal ??
    recommendations.reduce((sum, rec) => sum + (Number(rec.suggestedOrderQty) || 0), 0);
  const reorderTotal = summary?.total ?? recommendations.length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Automated Reorder Recommendations"
        description="Products at or below reorder threshold with calculated suggested purchase quantities"
        actions={
          <Button onClick={() => navigate(`/app/${activeWorkspace?.slug || ''}/purchases`)}>
            <ShoppingBag /> New Purchase Order
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Products to Reorder"
          value={reorderTotal}
          icon={ShoppingBag}
          isLoading={isLoading}
        />
        <StatCard
          title="Stockout Risk"
          value={criticalCount}
          icon={AlertOctagon}
          badge={criticalCount > 0 ? 'Critical' : undefined}
          isLoading={isLoading}
        />
        <StatCard
          title="Total Suggested Units"
          value={suggestedTotal}
          icon={CheckCircle2}
          isLoading={isLoading}
        />
      </div>

      <SearchFilterBar
        searchValue={searchQuery}
        onSearchChange={(v) => {
          resetPage();
          setSearchQuery(v);
        }}
        searchPlaceholder="Search by product name or SKU…"
      >
        <Select
          value={urgencyFilter}
          onValueChange={(v) => {
            resetPage();
            setUrgencyFilter(v);
          }}
        >
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="All urgencies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All urgencies</SelectItem>
            <SelectItem value="CRITICAL">Stockout risk</SelectItem>
            <SelectItem value="HIGH">Urgent reorder</SelectItem>
            <SelectItem value="standard">Reorder point reached</SelectItem>
          </SelectContent>
        </Select>
      </SearchFilterBar>

      <DataTable
        head={
          <>
            <TableHead>Product / SKU</TableHead>
            <TableHead>Current Stock</TableHead>
            <TableHead>Reorder Point</TableHead>
            <TableHead>Suggested PO Qty</TableHead>
            <TableHead>Urgency</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </>
        }
        isLoading={isLoading}
        loadingMessage="Analyzing stock levels..."
        error={error}
        onRetry={loadRecommendations}
        errorTitle="Couldn't load reorder recommendations"
        isEmpty={filteredRecommendations.length === 0}
        emptyTitle={
          recommendations.length === 0 ? 'All stock levels healthy' : 'No matching recommendations'
        }
        emptyDescription={
          recommendations.length === 0
            ? 'Every product is above its reorder threshold.'
            : 'Try adjusting your search or urgency filter.'
        }
        colSpan={6}
        columns={6}
      >
        {filteredRecommendations.map((rec) => (
          <TableRow key={rec.product.id}>
            <TableCell className="font-bold">
              {rec.product.name}{' '}
              <span className="text-xs font-normal text-muted-foreground">({rec.product.sku})</span>
            </TableCell>
            <TableCell
              className={
                rec.currentStock === 0 ? 'font-extrabold text-destructive' : 'font-extrabold text-warning'
              }
            >
              {rec.currentStock} {rec.product.unit}
            </TableCell>
            <TableCell className="font-semibold text-muted-foreground">{rec.reorderPoint}</TableCell>
            <TableCell className="font-extrabold text-success">+{rec.suggestedOrderQty} units</TableCell>
            <TableCell>{urgencyBadge(rec.urgency)}</TableCell>
            <TableCell className="text-right">
              <Button size="sm" onClick={() => navigate(`/app/${activeWorkspace?.slug || ''}/purchases`)}>
                <ShoppingBag /> Create Purchase Order
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
