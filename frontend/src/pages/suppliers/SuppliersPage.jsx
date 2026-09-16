import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { CreateSupplierModal } from './CreateSupplierModal';
import { Clock, Mail, MapPin, Phone, Plus, Truck } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PaginationBar } from '@/components/common/PaginationBar';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/DataTable';
import { usePagination } from '@/hooks/usePagination';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function SuppliersPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [suppliers, setSuppliers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { page, setPage, pageSize, total, totalPages, applyMeta } = usePagination();

  const loadSuppliers = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/suppliers?page=${page}&pageSize=${pageSize}`);
      setSuppliers(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load suppliers:', err);
      setError(err.message || 'Failed to load suppliers');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, [activeWorkspace, page]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Supplier Directory"
        description="Manage vendor profiles, payment terms, and fulfillment lead times"
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus />
            <span>Add Supplier</span>
          </Button>
        }
      />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {isLoading ? (
          <div className="col-span-full">
            <LoadingState message="Loading supplier profiles…" />
          </div>
        ) : error ? (
          <div className="col-span-full rounded-xl border border-border bg-card">
            <ErrorState description={error} onRetry={loadSuppliers} />
          </div>
        ) : suppliers.length === 0 ? (
          <div className="col-span-full">
            <EmptyState
              icon={Truck}
              title="No suppliers yet"
              description="Add your first vendor to start raising purchase orders."
            />
          </div>
        ) : (
          suppliers.map((s) => (
            <Card key={s.id} className="flex flex-col gap-3">
              <CardHeader className="pb-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Truck className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle>{s.name}</CardTitle>
                    <div className="mt-1">
                      <StatusBadge status={s.status} />
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent>
                <div className="flex flex-col gap-2 border-t border-border pt-3 text-[13px] text-muted-foreground">
                  {s.contact_name && <div className="font-semibold text-foreground">Contact: {s.contact_name}</div>}
                  {s.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 shrink-0" /> {s.email}</div>}
                  {s.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 shrink-0" /> {s.phone}</div>}
                  {s.address && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 shrink-0" /> {s.address}</div>}
                  <div className="flex items-center gap-2 font-semibold text-primary">
                    <Clock className="h-3.5 w-3.5 shrink-0" /> Lead Time: {s.lead_time_days || 7} Days
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />

      <CreateSupplierModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={loadSuppliers} />
    </div>
  );
}
