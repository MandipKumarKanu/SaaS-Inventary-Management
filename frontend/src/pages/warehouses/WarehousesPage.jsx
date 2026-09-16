import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { CreateWarehouseModal } from './CreateWarehouseModal';
import { MapPin, Phone, Plus, Trash2, Warehouse } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PaginationBar } from '@/components/common/PaginationBar';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/DataTable';
import { usePagination } from '@/hooks/usePagination';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';

export function WarehousesPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [warehouses, setWarehouses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { page, setPage, pageSize, total, totalPages, applyMeta } = usePagination();

  const loadWarehouses = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/warehouses?page=${page}&pageSize=${pageSize}`);
      setWarehouses(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load warehouses:', err);
      setError(err.message || 'Failed to load warehouses');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadWarehouses();
  }, [activeWorkspace, page]);

  const handleDelete = async (id) => {
    try {
      await api.delete(`/workspaces/${activeWorkspace.id}/warehouses/${id}`);
      loadWarehouses();
      toast.success('Warehouse deleted');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Warehouses & Storage Facilities"
        description={`Manage physical stock locations and bins for ${activeWorkspace?.name}`}
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus />
            <span>Add Warehouse</span>
          </Button>
        }
      />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {isLoading ? (
          <div className="col-span-full">
            <LoadingState message="Loading warehouses…" />
          </div>
        ) : error ? (
          <div className="col-span-full rounded-xl border border-border bg-card">
            <ErrorState description={error} onRetry={loadWarehouses} />
          </div>
        ) : warehouses.length === 0 ? (
          <div className="col-span-full">
            <EmptyState
              icon={Warehouse}
              title="No warehouses yet"
              description="Set up your primary storage facility to start tracking stock."
            />
          </div>
        ) : (
          warehouses.map((wh) => (
            <Card key={wh.id} className="flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Warehouse className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle>{wh.name}</CardTitle>
                      <code className="text-[11px] text-muted-foreground">{wh.code}</code>
                    </div>
                  </div>

                  <ConfirmDialog
                    title="Delete warehouse?"
                    description="This action cannot be undone. The storage facility and its bin assignments will be removed."
                    confirmLabel="Delete"
                    onConfirm={() => handleDelete(wh.id)}
                    trigger={
                      <Button variant="destructive" size="sm">
                        <Trash2 />
                      </Button>
                    }
                  />
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2 text-[13px] text-muted-foreground">
                  {wh.address && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span>{wh.address}</span>
                    </div>
                  )}
                  {wh.contact_number && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span>{wh.contact_number}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-border pt-3">
                  <StatusBadge status={wh.status} />
                  <span className="text-xs text-muted-foreground">
                    {wh.locations?.length || 0} Bin Locations
                  </span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />

      {isModalOpen && (
        <CreateWarehouseModal
          onClose={() => setIsModalOpen(false)}
          onWarehouseCreated={loadWarehouses}
        />
      )}
    </div>
  );
}
