import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Radio, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { PaginationBar } from '@/components/common/PaginationBar';
import { usePagination } from '@/hooks/usePagination';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Field } from '@/components/common/FormField';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { toast } from '@/components/ui/sonner';

export function WebhooksSettingsPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [subscriptions, setSubscriptions] = useState([]);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState(['stock.updated', 'po.received', 'so.shipped']);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const { page, setPage, pageSize, total, totalPages, applyMeta } = usePagination();

  const loadSubscriptions = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/webhooks?page=${page}&pageSize=${pageSize}`);
      setSubscriptions(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load webhook subscriptions:', err);
      setError(err.message || 'Failed to load webhooks');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSubscriptions();
  }, [activeWorkspace, page]);

  const handleCreateSub = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setIsSubmitting(true);
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/webhooks`, { url, events });
      setUrl('');
      loadSubscriptions();
    } catch (err) {
      toast.error(err.message || 'Failed to create webhook subscription');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/workspaces/${activeWorkspace.id}/webhooks/${id}`);
      loadSubscriptions();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Webhook Event Subscriptions"
        description="Dispatch real-time HTTP POST event notifications to external webhooks with HMAC-SHA256 signatures"
      />

      <Card>
        <CardHeader>
          <CardTitle>Add Endpoint Subscription</CardTitle>
          <CardDescription>Register a URL to receive signed event payloads.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateSub} className="flex flex-col gap-4">
            <Field label="Payload Delivery URL" htmlFor="webhook-url" required>
              <Input
                id="webhook-url"
                type="url"
                placeholder="https://api.mycompany.com/webhooks/inventory"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={isSubmitting}>
                <Plus className="h-4 w-4" />
                {isSubmitting ? 'Subscribing...' : 'Add Endpoint'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <DataTable
          head={
            <>
              <TableHead>Endpoint URL</TableHead>
              <TableHead>Secret</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </>
          }
          isLoading={isLoading}
          isEmpty={!isLoading && subscriptions.length === 0}
          error={error}
          onRetry={loadSubscriptions}
          errorTitle="Couldn't load webhooks"
          colSpan={4}
          columns={4}
          emptyTitle="No webhook endpoints registered."
        >
          {subscriptions.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-mono font-bold">
                <span className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-primary" />
                  {s.url}
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {s.secret.slice(0, 10)}...
              </TableCell>
              <TableCell>
                <StatusBadge status={s.status} />
              </TableCell>
              <TableCell className="text-right">
                <ConfirmDialog
                  title="Delete this webhook endpoint?"
                  description="This endpoint will stop receiving event notifications."
                  confirmLabel="Remove"
                  onConfirm={() => handleDelete(s.id)}
                  trigger={
                    <Button variant="outline" size="sm" className="text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      </Card>

      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
