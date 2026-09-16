import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Download, Database } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { PaginationBar } from '@/components/common/PaginationBar';
import { usePagination } from '@/hooks/usePagination';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { toast } from '@/components/ui/sonner';

export function BackupRecoveryPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [backups, setBackups] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState(null);
  const { page, setPage, pageSize, total, totalPages, applyMeta } = usePagination();

  const loadBackups = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/backup?page=${page}&pageSize=${pageSize}`);
      setBackups(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load backup snapshots:', err);
      setError(err.message || 'Failed to load backups');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBackups();
  }, [activeWorkspace, page]);

  const handleCreateBackup = async () => {
    setIsExporting(true);
    try {
      const res = await api.post(`/workspaces/${activeWorkspace.id}/backup/export`);
      toast.success(`Disaster Recovery Backup Created Successfully! File: ${res.data.file_name}`);
      loadBackups();
    } catch (err) {
      toast.error(err.message || 'Failed to export workspace backup');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Disaster Recovery & Data Export"
        description="Generate complete 1-click JSON snapshot exports of your organization data for offline archival compliance"
      />

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Create Full Workspace Backup</h3>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Includes all products, inventory balances, ledger transactions, warehouses, purchase orders, sales orders, and customer lists.
              </p>
            </div>
          </div>
          <Button onClick={handleCreateBackup} disabled={isExporting} className="shrink-0">
            <Download className="h-4 w-4" />
            {isExporting ? 'Generating Snapshot...' : 'Export Full Backup'}
          </Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b">
          <CardTitle>Backup Snapshot History</CardTitle>
          <CardDescription>Offline archival snapshots of this workspace.</CardDescription>
        </CardHeader>
        <DataTable
          head={
            <>
              <TableHead>File Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Snapshot Summary</TableHead>
              <TableHead>Exported At</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </>
          }
          isLoading={isLoading}
          isEmpty={!isLoading && backups.length === 0}
          error={error}
          onRetry={loadBackups}
          errorTitle="Couldn't load backups"
          colSpan={6}
          columns={6}
          emptyTitle="No backup snapshots created yet."
        >
          {backups.map((b) => (
            <TableRow key={b.id}>
              <TableCell className="font-mono font-bold">{b.file_name}</TableCell>
              <TableCell>
                <StatusBadge status={b.status} />
              </TableCell>
              <TableCell className="font-mono text-muted-foreground">
                {(b.file_size_bytes / 1024).toFixed(1)} KB
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {b.summary?.product_count || 0} SKUs, {b.summary?.inventory_records || 0} Inventory Rows, {b.summary?.purchase_orders || 0} POs, {b.summary?.sales_orders || 0} SOs
              </TableCell>
              <TableCell className="text-[13px] text-muted-foreground">
                {new Date(b.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-right">
                {b.download_url ? (
                  <Button variant="outline" size="sm" asChild>
                    <a href={b.download_url} download={b.file_name}>
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                  </Button>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      </Card>

      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
