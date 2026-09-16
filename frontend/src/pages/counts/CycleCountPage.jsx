import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { CreateCountModal } from './CreateCountModal';
import { Plus, Eye, ClipboardList, Building2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchFilterBar } from '@/components/common/SearchFilterBar';
import { DataTable } from '@/components/common/DataTable';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePagination } from '@/hooks/usePagination';
import { PaginationBar } from '@/components/common/PaginationBar';

export function CycleCountPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const navigate = useNavigate();
  const [counts, setCounts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const { page, setPage, pageSize, total, totalPages, resetPage, applyMeta } = usePagination();

  const loadCounts = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/counts?page=${page}&pageSize=${pageSize}`);
      setCounts(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load counts:', err);
      setError(err.message || 'Failed to load counts');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCounts();
  }, [activeWorkspace, page]);

  const query = searchValue.trim().toLowerCase();
  const filtered = query
    ? counts.filter((c) =>
        [c.count_number, c.warehouse?.name, c.warehouse?.code]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(query))
      )
    : counts;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cycle Counting & Audits"
        description="Physical inventory count sheets, system snapshot variance analysis, and manager approvals"
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus /> Start Cycle Count
          </Button>
        }
      />

      <SearchFilterBar
        searchValue={searchValue}
        onSearchChange={(v) => {
          resetPage();
          setSearchValue(v);
        }}
        searchPlaceholder="Search count sheet #, warehouse…"
      />

      <DataTable
        head={
          <>
            <TableHead>Count Sheet #</TableHead>
            <TableHead>Target Warehouse</TableHead>
            <TableHead>Items Audited</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </>
        }
        isLoading={isLoading}
        isEmpty={!isLoading && filtered.length === 0}
        error={error}
        onRetry={loadCounts}
        errorTitle="Couldn't load cycle counts"
        colSpan={6}
        columns={6}
        loadingMessage="Loading cycle count sheets..."
        emptyTitle="No cycle counts found"
        emptyDescription='Click "Start Cycle Count" to snapshot system inventory.'
      >
        {filtered.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="font-bold">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-primary" />
                {c.count_number}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                {c.warehouse?.name} ({c.warehouse?.code})
              </div>
            </TableCell>
            <TableCell className="font-semibold">
              <Badge variant="secondary">{c.items?.length || 0} items snapshot</Badge>
            </TableCell>
            <TableCell>
              <StatusBadge status={c.status} />
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(c.created_at).toLocaleDateString()}
            </TableCell>
            <TableCell className="text-right">
              <Button variant="outline" size="sm" onClick={() => navigate(`/counts/${c.id}`)}>
                <Eye /> Open Count Sheet
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />

      <CreateCountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={loadCounts}
      />
    </div>
  );
}
