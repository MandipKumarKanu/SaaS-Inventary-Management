import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { CreateTransferModal } from './CreateTransferModal';
import { Plus, Eye, ArrowRight, FileText } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchFilterBar } from '@/components/common/SearchFilterBar';
import { DataTable } from '@/components/common/DataTable';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { usePagination } from '@/hooks/usePagination';
import { PaginationBar } from '@/components/common/PaginationBar';

export function TransfersPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const navigate = useNavigate();
  const [transfers, setTransfers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const { page, setPage, pageSize, total, totalPages, resetPage, applyMeta } = usePagination();

  const loadTransfers = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', page);
      params.set('pageSize', pageSize);
      const url = `/workspaces/${activeWorkspace.id}/transfers?${params.toString()}`;
      const res = await api.get(url);
      setTransfers(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load transfers:', err);
      setError(err.message || 'Failed to load transfers');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTransfers();
  }, [activeWorkspace, statusFilter, page]);

  const query = searchValue.trim().toLowerCase();
  const filtered = query
    ? transfers.filter((t) =>
        [t.transfer_number, t.source_warehouse?.name, t.destination_warehouse?.name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(query))
      )
    : transfers;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stock Transfers"
        description="Manage multi-warehouse inventory transfer workflows and status pipelines"
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus /> Create Transfer
          </Button>
        }
      />

      <SearchFilterBar
        searchValue={searchValue}
        onSearchChange={(v) => {
          resetPage();
          setSearchValue(v);
        }}
        searchPlaceholder="Search transfer #, warehouse…"
      >
        <Select
          value={statusFilter || 'all'}
          onValueChange={(v) => {
            resetPage();
            setStatusFilter(v === 'all' ? '' : v);
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="requested">Requested</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="shipped">Shipped</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </SearchFilterBar>

      <DataTable
        head={
          <>
            <TableHead>Transfer #</TableHead>
            <TableHead>Source → Destination</TableHead>
            <TableHead>Items Count</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </>
        }
        isLoading={isLoading}
        error={error}
        onRetry={loadTransfers}
        errorTitle="Couldn't load transfers"
        isEmpty={!isLoading && filtered.length === 0}
        colSpan={6}
        columns={6}
        loadingMessage="Loading transfer records..."
        emptyTitle="No stock transfers found"
        emptyDescription='Click "Create Transfer" to initiate a warehouse transfer.'
      >
        {filtered.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="font-bold">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                {t.transfer_number}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2 text-[13px]">
                <Badge variant="secondary">{t.source_warehouse?.name || 'Source'}</Badge>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                <Badge variant="outline">{t.destination_warehouse?.name || 'Destination'}</Badge>
              </div>
            </TableCell>
            <TableCell className="font-semibold">
              <Badge variant="secondary">{t.items?.length || 0} line items</Badge>
            </TableCell>
            <TableCell>
              <StatusBadge status={t.status} />
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(t.created_at).toLocaleDateString()}
            </TableCell>
            <TableCell className="text-right">
              <Button variant="outline" size="sm" onClick={() => navigate(`/transfers/${t.id}`)}>
                <Eye /> View Details
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />

      <CreateTransferModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={loadTransfers}
      />
    </div>
  );
}
