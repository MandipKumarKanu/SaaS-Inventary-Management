import React, { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { AlertTriangle, CheckCircle2, Clock, DollarSign, ShieldAlert, Ban } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchFilterBar } from '@/components/common/SearchFilterBar';
import { DataTable } from '@/components/common/DataTable';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatusBadge } from '@/components/common/StatusBadge';
import { StatCard } from '@/components/common/StatCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { usePagination } from '@/hooks/usePagination';
import { PaginationBar } from '@/components/common/PaginationBar';
import { toast } from '@/components/ui/sonner';

export function BatchesPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [batches, setBatches] = useState([]);
  const [expiryOverview, setExpiryOverview] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchValue, setSearchValue] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const { page, setPage, pageSize, total, totalPages, resetPage, applyMeta } = usePagination();

  const loadBatches = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const [batchesRes, overviewRes] = await Promise.allSettled([
        api.get(`/workspaces/${activeWorkspace.id}/batches?page=${page}&pageSize=${pageSize}`),
        api.get(`/workspaces/${activeWorkspace.id}/batches/expiry-overview`),
      ]);

      if (batchesRes.status === 'fulfilled') {
        setBatches(batchesRes.value.data || []);
        applyMeta(batchesRes.value.meta);
      } else {
        throw batchesRes.reason;
      }

      if (overviewRes.status === 'fulfilled') {
        setExpiryOverview(overviewRes.value.data || null);
      }
    } catch (err) {
      console.error('Failed to load batch telemetry:', err);
      setError(err.message || 'Failed to load batch telemetry');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBatches();
  }, [activeWorkspace, page]);

  const handleWriteOffExpired = async (batchId, batchNumber, currentQty) => {
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/batches/${batchId}/adjust`, {
        qtyChange: -currentQty,
        reason: 'expired',
        notes: `Write off expired batch ${batchNumber} via FEFO Dashboard`,
      });
      toast.success(`Batch ${batchNumber} written off successfully`);
      loadBatches();
    } catch (err) {
      toast.error(err.message || 'Failed to write off batch');
    }
  };

  const query = searchValue.trim().toLowerCase();
  const filtered = batches.filter((b) => {
    const matchesSearch = query
      ? [b.batch_number, b.product?.name, b.product?.sku, b.warehouse?.name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(query))
      : true;

    const matchesStatus =
      statusFilter === 'ALL'
        ? true
        : statusFilter === 'EXPIRED'
        ? b.expirationStatus === 'Expired'
        : statusFilter === 'EXPIRING_SOON'
        ? b.expirationStatus === 'Expiring Soon'
        : b.expirationStatus === 'Valid';

    return matchesSearch && matchesStatus;
  });

  const summary = expiryOverview?.summary || {
    expiredCount: batches.filter((b) => b.expirationStatus === 'Expired').length,
    expiring30Count: batches.filter((b) => b.expirationStatus === 'Expiring Soon').length,
    totalValueAtRisk: 0,
    totalBatches: batches.length,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Batch & Lot FEFO Expiration Dashboard"
        description="First-Expired-First-Out (FEFO) inventory control, batch shelf-life monitoring, and stock risk telemetry"
      />

      {summary.expiredCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <div className="flex-1 text-sm font-semibold">
            Urgent FEFO Warning: {summary.expiredCount} batch(es) have expired! Immediate write-off or quarantine required to prevent dispatching expired stock.
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Healthy Batches"
          value={summary.totalBatches - summary.expiredCount - summary.expiring30Count}
          icon={CheckCircle2}
          isLoading={isLoading}
        />
        <StatCard
          title="Expiring Soon (< 30 Days)"
          value={summary.expiring30Count}
          icon={Clock}
          isLoading={isLoading}
        />
        <StatCard
          title="Expired Batches"
          value={summary.expiredCount}
          icon={AlertTriangle}
          isLoading={isLoading}
        />
        <StatCard
          title="Stock Value at Expiry Risk"
          value={`$${summary.totalValueAtRisk?.toLocaleString() || '0'}`}
          icon={DollarSign}
          isLoading={isLoading}
        />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <SearchFilterBar
          searchValue={searchValue}
          onSearchChange={(v) => {
            resetPage();
            setSearchValue(v);
          }}
          searchPlaceholder="Search batch #, product, SKU, warehouse…"
        />
        <div className="flex items-center gap-1.5 rounded-lg border p-1">
          <Button
            variant={statusFilter === 'ALL' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setStatusFilter('ALL')}
          >
            All
          </Button>
          <Button
            variant={statusFilter === 'EXPIRING_SOON' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setStatusFilter('EXPIRING_SOON')}
          >
            Expiring Soon
          </Button>
          <Button
            variant={statusFilter === 'EXPIRED' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setStatusFilter('EXPIRED')}
          >
            Expired
          </Button>
        </div>
      </div>

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
            <TableHead className="text-right">FEFO Action</TableHead>
          </>
        }
        isLoading={isLoading}
        isEmpty={!isLoading && filtered.length === 0}
        error={error}
        onRetry={loadBatches}
        errorTitle="Couldn't load batches"
        colSpan={8}
        columns={8}
        loadingMessage="Loading FEFO batch records..."
        emptyTitle="No batch tracking data recorded yet"
        emptyDescription="Batch-tracked inventory will appear here."
      >
        {filtered.map((b) => {
          const qty = b.synced_quantity ?? b.quantity ?? 0;
          return (
            <TableRow key={b.id}>
              <TableCell className="font-bold font-mono">{b.batch_number}</TableCell>
              <TableCell className="font-semibold">
                {b.product?.name}{' '}
                <span className="text-xs font-normal text-muted-foreground">({b.product?.sku})</span>
              </TableCell>
              <TableCell>{b.warehouse?.name}</TableCell>
              <TableCell className="font-extrabold">
                <Badge variant="secondary">{qty}</Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {b.mfg_date ? new Date(b.mfg_date).toLocaleDateString() : '-'}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground font-medium">
                {b.expiry_date ? new Date(b.expiry_date).toLocaleDateString() : '-'}
              </TableCell>
              <TableCell>
                <StatusBadge status={b.expirationStatus} />
              </TableCell>
              <TableCell className="text-right">
                {b.expirationStatus === 'Expired' && qty > 0 ? (
                  <ConfirmDialog
                    title={`Write off expired batch ${b.batch_number}?`}
                    description={`This will write off all ${qty} units of expired stock from batch ${b.batch_number} and record the write-off in the ledger.`}
                    confirmLabel="Write Off Expired Stock"
                    destructive={true}
                    onConfirm={() => handleWriteOffExpired(b.id, b.batch_number, qty)}
                    trigger={
                      <Button variant="destructive" size="sm" className="gap-1">
                        <Ban className="h-3.5 w-3.5" /> Write Off
                      </Button>
                    }
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>
      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
