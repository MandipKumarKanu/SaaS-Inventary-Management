import React, { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { ArrowUpRight, ArrowDownRight, Clock } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchFilterBar } from '@/components/common/SearchFilterBar';
import { DataTable } from '@/components/common/DataTable';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PaginationBar } from '@/components/common/PaginationBar';
import { usePagination } from '@/hooks/usePagination';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

export function TransactionLedgerPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [movementFilter, setMovementFilter] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [error, setError] = useState(null);
  const { page, setPage, pageSize, total, totalPages, resetPage, applyMeta } = usePagination();

  const loadLedger = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(
        `/workspaces/${activeWorkspace.id}/inventory/transactions?page=${page}&pageSize=${pageSize}&movementType=${movementFilter}`
      );
      setTransactions(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load inventory transaction ledger:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLedger();
  }, [activeWorkspace, movementFilter, page]);

  const query = searchValue.trim().toLowerCase();
  const filtered = query
    ? transactions.filter((tx) =>
        [tx.product?.name, tx.product?.sku, tx.warehouse?.name, tx.user?.name, tx.user?.email, tx.notes]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(query))
      )
    : transactions;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventory Ledger"
        description={`Complete, tamper-proof history of all inventory movements in ${activeWorkspace?.name}`}
        actions={<Badge variant="outline">Immutable Stock Audit Trail</Badge>}
      />

      <SearchFilterBar
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchPlaceholder="Search SKU, warehouse, user…"
      >
        <Select
          value={movementFilter || 'all'}
          onValueChange={(v) => {
            resetPage();
            setMovementFilter(v === 'all' ? '' : v);
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Movement Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Movement Types</SelectItem>
            <SelectItem value="opening_balance">Opening Balance</SelectItem>
            <SelectItem value="adjustment">Adjustment</SelectItem>
            <SelectItem value="purchase_received">Purchase Received</SelectItem>
            <SelectItem value="sales_shipped">Sales Shipped</SelectItem>
            <SelectItem value="transfer_in">Transfer Received</SelectItem>
            <SelectItem value="transfer_out">Transfer Dispatched</SelectItem>
            <SelectItem value="return">Customer Return</SelectItem>
          </SelectContent>
        </Select>
      </SearchFilterBar>

      <DataTable
        head={
          <>
            <TableHead>Timestamp</TableHead>
            <TableHead>Product SKU</TableHead>
            <TableHead>Warehouse</TableHead>
            <TableHead>Movement</TableHead>
            <TableHead>Before → Change → After</TableHead>
            <TableHead>User / Performer</TableHead>
            <TableHead>Notes</TableHead>
          </>
        }
        isLoading={isLoading}
        isEmpty={!isLoading && filtered.length === 0}
        error={error}
        onRetry={loadLedger}
        errorTitle="Couldn't load ledger"
        colSpan={7}
        columns={7}
        loadingMessage="Loading immutable ledger..."
        emptyTitle="No transaction ledger entries recorded"
        emptyDescription="Stock adjustments and movements will appear here."
      >
        {filtered.map((tx) => {
          const isPositive = tx.qty_change > 0;
          return (
            <TableRow key={tx.id}>
              <TableCell className="text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  <span>{new Date(tx.created_at).toLocaleString()}</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="font-semibold">{tx.product?.name || 'Product'}</div>
                <code className="text-xs text-muted-foreground">{tx.product?.sku}</code>
              </TableCell>
              <TableCell className="text-[13px] text-muted-foreground">
                {tx.warehouse?.name} ({tx.warehouse?.code})
              </TableCell>
              <TableCell>
                <StatusBadge status={tx.movement_type}>
                  <span className="flex items-center gap-1">
                    {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {tx.movement_type}
                  </span>
                </StatusBadge>
              </TableCell>
              <TableCell>
                <div className="text-[13px] font-semibold">
                  <span className="text-muted-foreground">{tx.qty_before}</span>
                  <span className={`mx-1.5 ${isPositive ? 'text-success' : 'text-destructive'}`}>
                    {isPositive ? `+${tx.qty_change}` : tx.qty_change}
                  </span>
                  <span>→ {tx.qty_after}</span>
                </div>
              </TableCell>
              <TableCell className="text-[13px] text-muted-foreground">
                {tx.user?.name || tx.user?.email || 'System'}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{tx.notes || '—'}</TableCell>
            </TableRow>
          );
        })}
      </DataTable>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        onPageChange={setPage}
      />
    </div>
  );
}
