import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Building2, Users, DollarSign, Activity } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, LoadingState } from '@/components/common/DataTable';
import { StatCard } from '@/components/common/StatCard';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';

export function SaaSAdminPortalPage() {
  const [overview, setOverview] = useState(null);
  const [health, setHealth] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadOverview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [overviewRes, healthRes] = await Promise.allSettled([
        api.get('/admin/overview'),
        api.get('/monitoring/health'),
      ]);
      if (overviewRes.status === 'fulfilled') {
        setOverview(overviewRes.value.data);
      } else {
        throw overviewRes.reason;
      }
      if (healthRes.status === 'fulfilled') {
        setHealth(healthRes.value.data || null);
      }
    } catch (err) {
      console.error('Failed to load admin overview:', err);
      setError(err.message || 'Failed to load admin overview');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="SaaS Platform Admin Portal"
        description="Platform-wide multi-tenant statistics, workspace health, subscription MRR, and platform audit controls"
      />

      {isLoading && !overview ? (
        <LoadingState message="Loading platform super admin telemetry..." />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Total Organizations / Workspaces"
              value={overview?.totalWorkspaces ?? '—'}
              icon={Building2}
              isLoading={isLoading}
            />
            <StatCard
              title="Total Platform Accounts"
              value={overview?.totalUsers != null ? `${overview.totalUsers} Users` : '—'}
              icon={Users}
              isLoading={isLoading}
            />
            <StatCard
              title="Monthly Recurring Revenue (MRR)"
              value={overview?.totalMRR != null ? `$${overview.totalMRR?.toLocaleString()}/mo` : '—'}
              icon={DollarSign}
              isLoading={isLoading}
            />
            <StatCard
              title="System Health Status"
              value={
                !health
                  ? '—'
                  : String(health.status || '').toLowerCase() === 'operational'
                    ? 'Operational'
                    : `Degraded (${health.status})`
              }
              icon={Activity}
              badge={
                health?.uptime_seconds != null
                  ? `${Math.floor(health.uptime_seconds / 60)} mins uptime`
                  : undefined
              }
              isLoading={isLoading}
            />
          </div>

          <Card className="overflow-hidden p-0">
            <CardHeader className="border-b">
              <CardTitle>Registered Tenant Workspaces</CardTitle>
            </CardHeader>
            <DataTable
              head={
                <>
                  <TableHead>Workspace Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Status</TableHead>
                </>
              }
              isLoading={isLoading}
              isEmpty={!isLoading && (!overview?.workspaces || overview.workspaces.length === 0)}
              error={error}
              onRetry={loadOverview}
              errorTitle="Couldn't load platform overview"
              colSpan={4}
              columns={4}
              emptyTitle="No tenant workspaces registered."
            >
              {overview?.workspaces?.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-bold">
                    <span className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      {w.name}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">{w.slug}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {new Date(w.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status="active" />
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </Card>
        </>
      )}
    </div>
  );
}
