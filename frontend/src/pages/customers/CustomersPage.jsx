import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { CreateCustomerModal } from './CreateCustomerModal';
import { Mail, MapPin, Phone, Plus, Users } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PaginationBar } from '@/components/common/PaginationBar';
import { usePagination } from '@/hooks/usePagination';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function CustomersPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [customers, setCustomers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { page, setPage, pageSize, total, totalPages, applyMeta } = usePagination();

  const loadCustomers = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/customers?page=${page}&pageSize=${pageSize}`);
      setCustomers(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load customers:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, [activeWorkspace, page]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customer Directory"
        description="Manage commercial accounts, shipping addresses, and sales contacts"
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus />
            <span>Add Customer</span>
          </Button>
        }
      />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {isLoading ? (
          <div className="col-span-full px-6 py-12 text-center text-sm text-muted-foreground">
            Loading customer accounts...
          </div>
        ) : customers.length === 0 ? (
          <div className="col-span-full px-6 py-12 text-center text-sm text-muted-foreground">
            No customer profiles created yet. Click &quot;Add Customer&quot; to start.
          </div>
        ) : (
          customers.map((c) => (
            <Card key={c.id} className="flex flex-col gap-3">
              <CardHeader className="pb-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle>{c.name}</CardTitle>
                    <div className="mt-1">
                      <StatusBadge status={c.status} />
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent>
                <div className="flex flex-col gap-2 border-t border-border pt-3 text-[13px] text-muted-foreground">
                  {c.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 shrink-0" /> {c.email}</div>}
                  {c.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 shrink-0" /> {c.phone}</div>}
                  {c.address && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 shrink-0" /> {c.address}</div>}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />

      <CreateCustomerModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={loadCustomers} />
    </div>
  );
}
