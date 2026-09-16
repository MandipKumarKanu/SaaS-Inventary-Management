import React, { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchFilterBar } from '@/components/common/SearchFilterBar';
import { DataTable } from '@/components/common/DataTable';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatusBadge } from '@/components/common/StatusBadge';
import { StatCard } from '@/components/common/StatCard';
import { Badge } from '@/components/ui/badge';
import { usePagination } from '@/hooks/usePagination';
import { PaginationBar } from '@/components/common/PaginationBar';

export function BatchesPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [batches, setBatches] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchValue, setSearchValue] = useState('');
  const { page, setPage, pageSize, total, totalPages, resetPage, applyMeta } = usePagination();

  const loadBatches = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/batches?page=${page}&pageSize=${pageSize}`);
      setBatches(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load batches:', err);
      setError(err.message || 'Failed to load batches');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBatches();
  }, [activeWorkspace, page]);

  const query = searchValue.trim().toLowerCase();
  const filtered = query
    ? batches.filter((b) =>
        [b.batch_number, b.product?.name, b.product?.sku, b.warehouse?.name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(query))
      )
    : batches;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Batch & Lot FEFO Expiration Dashboard"
        description="First-Expired-First-Out (FEFO) inventory tracking, batch numbers, manufacturing & shelf-life expiry dates"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Valid Batches"
          value={batches.filter((b) => b.expirationStatus === 'Valid').length}
          icon={CheckCircle2}
          isLoading={isLoading}
        />
        <StatCard
          title="Expiring Soon (< 30 Days)"
          value={batches.filter((b) => b.expirationStatus === 'Expiring Soon').length}
          icon={Clock}
          isLoading={isLoading}
        />
        <StatCard
          title="Expired Batches"
          value={batches.filter((b) => b.expirationStatus === 'Expired').length}
          icon={AlertTriangle}
          isLoading={isLoading}
        />
      </div>

      <SearchFilterBar
        searchValue={searchValue}
        onSearchChange={(v) => {
          resetPage();
          setSearchValue(v);
        }}
        searchPlaceholder="Search batch #, product, SKU…"
      />

      <DataTable
        head={
          <>
            <TableHead>Batch / Lot #</TableHead>
            <TableHead>Product / SKU</TableHead>
            <TableHead>Warehouse</TableHead>
            <TableHead>Quantity</TableHead>
            <TableHead>Mfg Date</TableHead>
            <TableHead>Expiry Date</TableHead>
            <TableHead>Status</TableHead>
          </>
        }
        isLoading={isLoading}
        isEmpty={!isLoading && filtered.length === 0}
        error={error}
        onRetry={loadBatches}
        errorTitle="Couldn't load batches"
        colSpan={7}
        columns={7}
        loadingMessage="Loading batch records..."
        emptyTitle="No batch tracking data recorded yet"
        emptyDescription="Batch-tracked inventory will appear here."
      >
        {filtered.map((b) => (
          <TableRow key={b.id}>
            <TableCell className="font-bold">{b.batch_number}</TableCell>
            <TableCell className="font-semibold">
              {b.product?.name}{' '}
              <span className="text-xs font-normal text-muted-foreground">({b.product?.sku})</span>
            </TableCell>
            <TableCell>{b.warehouse?.name}</TableCell>
            <TableCell className="font-extrabold">
              <Badge variant="secondary">{b.quantity}</Badge>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {b.mfg_date ? new Date(b.mfg_date).toLocaleDateString() : '-'}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {b.expiry_date ? new Date(b.expiry_date).toLocaleDateString() : '-'}
            </TableCell>
            <TableCell>
              <StatusBadge status={b.expirationStatus} />
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
