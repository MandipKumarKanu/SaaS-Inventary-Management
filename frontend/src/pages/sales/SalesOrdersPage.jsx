import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { CreateSOModal } from './CreateSOModal';
import { ShoppingCart, Plus, Eye } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchFilterBar } from '@/components/common/SearchFilterBar';
import { DataTable } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePagination } from '@/hooks/usePagination';
import { PaginationBar } from '@/components/common/PaginationBar';

import { useCurrency } from '../../lib/currency';

export function SalesOrdersPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const { format } = useCurrency();
  const navigate = useNavigate();
  const [sos, setSos] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const { page, setPage, pageSize, total, totalPages, resetPage, applyMeta } = usePagination();

  const loadSOs = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/sales?page=${page}&pageSize=${pageSize}`);
      setSos(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load SOs:', err);
      setError(err.message || 'Failed to load sales orders');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSOs();
  }, [activeWorkspace, page]);

  const filteredSOs = sos.filter((s) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      s.so_number?.toLowerCase().includes(query) ||
      s.customer?.name?.toLowerCase().includes(query);
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sales Orders"
        description="Customer orders, fulfillment status, and automated stock deduction"
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus /> Create SO
          </Button>
        }
      />

      <SearchFilterBar
        searchValue={searchQuery}
        onSearchChange={(v) => {
          resetPage();
          setSearchQuery(v);
        }}
        searchPlaceholder="Search by SO number or customer…"
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
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="shipped">Shipped</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
          </SelectContent>
        </Select>
      </SearchFilterBar>

      <DataTable
        head={
          <>
            <TableHead>SO Number</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Fulfillment Warehouse</TableHead>
            <TableHead>Total Value</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </>
        }
        isLoading={isLoading}
        loadingMessage="Loading sales orders..."
        error={error}
        onRetry={loadSOs}
        errorTitle="Couldn't load sales orders"
        isEmpty={filteredSOs.length === 0}
        emptyTitle={sos.length === 0 ? 'No sales orders yet' : 'No matching sales orders'}
        emptyDescription={
          sos.length === 0
            ? 'Click "Create SO" to register a customer order.'
            : 'Try adjusting your search or status filter.'
        }
        colSpan={6}
        columns={6}
      >
        {filteredSOs.map((s) => (
          <TableRow key={s.id}>
            <TableCell className="font-bold">
              <span className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-primary" />
                {s.so_number}
              </span>
            </TableCell>
            <TableCell className="font-semibold">{s.customer?.name || 'Walk-in Customer'}</TableCell>
            <TableCell>
              {s.warehouse?.name} ({s.warehouse?.code})
            </TableCell>
            <TableCell className="font-extrabold text-success">{format(s.total_amount)}</TableCell>
            <TableCell>
              <StatusBadge status={s.status} />
            </TableCell>
            <TableCell className="text-right">
              <Button variant="outline" size="sm" onClick={() => navigate(`/sales/${s.id}`)}>
                <Eye /> Open SO
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />

      <CreateSOModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={loadSOs} />
    </div>
  );
}
