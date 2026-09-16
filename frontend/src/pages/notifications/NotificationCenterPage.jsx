import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Bell, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { PaginationBar } from '@/components/common/PaginationBar';
import { usePagination } from '@/hooks/usePagination';
import { StatusBadge } from '@/components/common/StatusBadge';
import { LoadingState } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export function NotificationCenterPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [notifications, setNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [counts, setCounts] = useState(null);
  const { page, setPage, pageSize, total, totalPages, resetPage, applyMeta } = usePagination();

  const loadNotifications = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    try {
      const res = await api.get(
        `/workspaces/${activeWorkspace.id}/notifications?page=${page}&pageSize=${pageSize}&severity=${filter}`
      );
      setNotifications(res.data || []);
      applyMeta(res.meta);
      setCounts(res.meta?.counts || null);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [activeWorkspace, page, filter]);

  // Server filters by severity; tab counts come from meta (full-set scope).
  const filtered = notifications;

  const countFor = (severity) => {
    if (counts) return severity === 'all' ? counts.all : (counts[severity] ?? 0);
    return severity === 'all'
      ? notifications.length
      : notifications.filter((n) => n.severity === severity).length;
  };

  const severityVariant = (severity) =>
    severity === 'error' ? 'destructive' : severity === 'warning' ? 'warning' : 'default';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notification & Alert Center"
        description="Real-time operational alerts for low stock, pending transfers, and audit reviews"
      />

      <Tabs
        value={filter}
        onValueChange={(v) => {
          resetPage();
          setFilter(v);
        }}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="all">
            All <Badge variant="secondary">{countFor('all')}</Badge>
          </TabsTrigger>
          <TabsTrigger value="error">
            Errors <Badge variant="secondary">{countFor('error')}</Badge>
          </TabsTrigger>
          <TabsTrigger value="warning">
            Warnings <Badge variant="secondary">{countFor('warning')}</Badge>
          </TabsTrigger>
          <TabsTrigger value="info">
            Info <Badge variant="secondary">{countFor('info')}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={filter}>
          {isLoading ? (
            <LoadingState message="Loading system notifications..." />
          ) : filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon={Bell}
                title="No notifications"
                description={`No unaddressed operational warnings or alerts in ${activeWorkspace?.name}.`}
              />
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {filtered.map((n) => (
                <Card key={n.id}>
                  <CardContent className="flex items-center gap-4 p-4 sm:p-5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      {n.severity === 'error' ? (
                        <AlertTriangle className="h-5 w-5" />
                      ) : (
                        <Bell className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-bold">{n.title}</span>
                        <StatusBadge status={n.severity} variant={severityVariant(n.severity)} />
                      </div>
                      <div className="mt-0.5 text-[13px] text-muted-foreground">{n.message}</div>
                    </div>
                    <div className="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(n.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
