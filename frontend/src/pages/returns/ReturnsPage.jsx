import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { CreateReturnModal } from './CreateReturnModal';
import { RotateCcw, Plus, Eye } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchFilterBar } from '@/components/common/SearchFilterBar';
import { DataTable } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePagination } from '@/hooks/usePagination';
import { PaginationBar } from '@/components/common/PaginationBar';

export function ReturnsPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const navigate = useNavigate();
  const [returns, setReturns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const { page, setPage, pageSize, total, totalPages, resetPage, applyMeta } = usePagination();

  const loadReturns = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/returns?page=${page}&pageSize=${pageSize}`);
      setReturns(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load returns:', err);
      setError(err.message || 'Failed to load returns');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReturns();
  }, [activeWorkspace, page]);

  const filteredReturns = returns.filter((r) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      r.return_number?.toLowerCase().includes(query) ||
      r.customer?.name?.toLowerCase().includes(query);
    const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customer Returns (RMA)"
        description="Product return authorizations, item inspection, and inventory restocking"
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus /> Issue Return
          </Button>
        }
      />

      <SearchFilterBar
        searchValue={searchQuery}
        onSearchChange={(v) => {
          resetPage();
          setSearchQuery(v);
        }}
        searchPlaceholder="Search by RMA number or customer…"
      >
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            resetPage();
            setStatusFilter(v);
          }}
        >
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="requested">Requested</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </SearchFilterBar>

      <DataTable
        head={
          <>
            <TableHead>RMA Number</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Return Warehouse</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </>
        }
        isLoading={isLoading}
        loadingMessage="Loading customer returns..."
        error={error}
        onRetry={loadReturns}
        errorTitle="Couldn't load returns"
        isEmpty={filteredReturns.length === 0}
        emptyTitle={returns.length === 0 ? 'No customer returns yet' : 'No matching returns'}
        emptyDescription={
          returns.length === 0
            ? 'Click "Issue Return" to start your first return authorization.'
            : 'Try adjusting your search or status filter.'
        }
        colSpan={6}
        columns={6}
      >
        {filteredReturns.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-bold">
              <span className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-primary" />
                {r.return_number}
              </span>
            </TableCell>
            <TableCell className="font-semibold">{r.customer?.name || 'Standard Account'}</TableCell>
            <TableCell>
              {r.warehouse?.name} ({r.warehouse?.code})
            </TableCell>
            <TableCell>
              <StatusBadge status={r.status} />
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(r.created_at).toLocaleDateString()}
            </TableCell>
            <TableCell className="text-right">
              <Button variant="outline" size="sm" onClick={() => navigate(`/returns/${r.id}`)}>
                <Eye /> Open Return
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />

      <CreateReturnModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={loadReturns}
      />
    </div>
  );
}
