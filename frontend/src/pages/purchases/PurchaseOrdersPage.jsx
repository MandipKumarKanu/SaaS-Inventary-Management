import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { CreatePOModal } from './CreatePOModal';
import { ShoppingBag, Plus, Eye } from 'lucide-react';
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

export function PurchaseOrdersPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const { format } = useCurrency();
  const navigate = useNavigate();
  const [pos, setPos] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const { page, setPage, pageSize, total, totalPages, resetPage, applyMeta } = usePagination();

  const loadPOs = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/purchases?page=${page}&pageSize=${pageSize}`);
      setPos(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load POs:', err);
      setError(err.message || 'Failed to load purchase orders');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPOs();
  }, [activeWorkspace, page]);

  const filteredPOs = pos.filter((p) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      p.po_number?.toLowerCase().includes(query) ||
      p.supplier?.name?.toLowerCase().includes(query);
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchase Orders"
        description="Manage vendor purchase orders, expected deliveries, and partial goods receiving"
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus /> Create PO
          </Button>
        }
      />

      <SearchFilterBar
        searchValue={searchQuery}
        onSearchChange={(v) => {
          resetPage();
          setSearchQuery(v);
        }}
        searchPlaceholder="Search by PO number or supplier…"
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
            <SelectItem value="ordered">Ordered</SelectItem>
            <SelectItem value="partially_received">Partially received</SelectItem>
            <SelectItem value="received">Received</SelectItem>
          </SelectContent>
        </Select>
      </SearchFilterBar>

      <DataTable
        head={
          <>
            <TableHead>PO Number</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Destination Warehouse</TableHead>
            <TableHead>Total Value</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </>
        }
        isLoading={isLoading}
        loadingMessage="Loading purchase orders..."
        error={error}
        onRetry={loadPOs}
        errorTitle="Couldn't load purchase orders"
        isEmpty={filteredPOs.length === 0}
        emptyTitle={pos.length === 0 ? 'No purchase orders yet' : 'No matching purchase orders'}
        emptyDescription={
          pos.length === 0
            ? 'Click "Create PO" to issue an order to a supplier.'
            : 'Try adjusting your search or status filter.'
        }
        colSpan={6}
        columns={6}
      >
        {filteredPOs.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="font-bold">
              <span className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-primary" />
                {p.po_number}
              </span>
            </TableCell>
            <TableCell className="font-semibold">{p.supplier?.name}</TableCell>
            <TableCell>
              {p.warehouse?.name} ({p.warehouse?.code})
            </TableCell>
            <TableCell className="font-extrabold text-success">{format(p.total_amount)}</TableCell>
            <TableCell>
              <StatusBadge status={p.status} />
            </TableCell>
            <TableCell className="text-right">
              <Button variant="outline" size="sm" onClick={() => navigate(`/purchases/${p.id}`)}>
                <Eye /> Open PO
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />

      <CreatePOModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={loadPOs} />
    </div>
  );
}
