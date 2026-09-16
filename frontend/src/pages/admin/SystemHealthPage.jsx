import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Activity, Database, Cpu, RefreshCw, Server, Clock } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { DataTable } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';

export function SystemHealthPage() {
  const [health, setHealth] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadHealthData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [hRes, mRes] = await Promise.all([
        api.get('/monitoring/health'),
        api.get('/monitoring/metrics'),
      ]);
      setHealth(hRes.data || null);
      setMetrics(mRes.data || null);
    } catch (err) {
      console.error('Failed to load system telemetry:', err);
      setError(err.message || 'Failed to load system telemetry');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHealthData();
    const interval = setInterval(loadHealthData, 15000); // Auto refresh every 15s
    return () => clearInterval(interval);
  }, []);

  const statusValue = (health?.status || 'OPERATIONAL').toUpperCase();
  const isDegraded =
    health?.status && !['ok', 'operational', 'healthy'].includes(String(health.status).toLowerCase());
  const hasWorkerJobs = health?.recent_worker_jobs && health.recent_worker_jobs.length > 0;

  // Show an em dash when telemetry is missing instead of plausible-looking
  // placeholder numbers.
  const metric = (value, suffix = '') =>
    value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : `${value}${suffix}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="System APM & Infrastructure Telemetry"
        description="Real-time database query latency, memory allocation, TTL cache stats, and scheduled worker logs"
        actions={
          <Button onClick={loadHealthData} disabled={isLoading} variant="secondary">
            <RefreshCw className={isLoading ? 'animate-spin' : undefined} /> Refresh Telemetry
          </Button>
        }
      />

      {isDegraded && (
        <Alert variant="warning">
          <AlertTitle>Degraded status: {health.status}</AlertTitle>
          <AlertDescription>
            One or more infrastructure checks are reporting a non-operational status. Review the
            worker logs below.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="System Status"
          value={statusValue}
          icon={Server}
          badge={`${Math.floor((health?.uptime_seconds || 0) / 60)} mins uptime`}
          isLoading={isLoading && !health}
        />
        <StatCard
          title="Supabase DB Latency"
          value={metric(health?.database?.latency_ms, ' ms')}
          icon={Database}
          badge={health?.database?.status ? `Pooler: ${health.database.status}` : undefined}
          isLoading={isLoading && !health}
        />
        <StatCard
          title="Node Heap Memory"
          value={metric(health?.memory?.heap_used_mb, ' MB')}
          icon={Cpu}
          badge={
            health?.memory?.heap_total_mb != null
              ? `Total Heap: ${health.memory.heap_total_mb} MB`
              : undefined
          }
          isLoading={isLoading && !health}
        />
        <StatCard
          title="P95 API Latency"
          value={metric(metrics?.p95_latency_ms, ' ms')}
          icon={Activity}
          badge={
            metrics?.error_rate_percent != null
              ? `Error Rate: ${metrics.error_rate_percent}%`
              : undefined
          }
          isLoading={isLoading && !metrics}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-[18px] w-[18px] text-primary" /> Scheduled Background Worker Logs
          </CardTitle>
          <CardDescription>Recent executions of scheduled background jobs</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            head={
              <>
                <TableHead>Job Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Execution Details</TableHead>
                <TableHead>Executed At</TableHead>
              </>
            }
            isLoading={isLoading && !health}
            isEmpty={!isLoading && !hasWorkerJobs}
            error={error}
            onRetry={loadHealthData}
            errorTitle="Couldn't load system telemetry"
            colSpan={4}
            columns={4}
            loadingMessage="Loading worker logs..."
            emptyTitle="No background worker jobs recorded."
          >
            {health?.recent_worker_jobs?.map((j) => (
              <TableRow key={j.id}>
                <TableCell>
                  <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">
                    {j.job_name}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={j.status} />
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {JSON.stringify(j.details)}
                </TableCell>
                <TableCell className="text-[13px] text-muted-foreground">
                  {new Date(j.executed_at).toLocaleTimeString()}
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>
    </div>
  );
}
