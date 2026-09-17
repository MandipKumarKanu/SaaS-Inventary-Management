import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { api } from '../../lib/api';
import { ArrowLeft, RefreshCw, ScrollText } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/sonner';

/**
 * §69 audit-event micro-detail: full audit row including before/after
 * values (previous_value/new_value) and actor/workspace context.
 * Read-only — audit rows are immutable (§60).
 */
export function AdminAuditEventDetailPage() {
  const { auditId } = useParams();
  const [event, setEvent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/admin/audit-logs/${auditId}`);
      setEvent(res.data || null);
    } catch (err) {
      setError(err.message || 'Failed to load audit event');
    } finally {
      setIsLoading(false);
    }
  }, [auditId]);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="flex flex-col items-start gap-4 p-6">
        <p className="text-sm text-destructive">{error || 'Audit event not found'}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/admin-portal">Back to portal</Link>
          </Button>
        </div>
      </div>
    );
  }

  const row = (label, value) => (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value ?? '—'}</div>
    </div>
  );

  const jsonBlock = (label, value) => (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
        {value ? JSON.stringify(value, null, 2) : '—'}
      </pre>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link to="/admin-portal">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Admin portal
          </Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ScrollText className="h-6 w-6" /> {event.action}
        </h1>
        <p className="font-mono text-sm text-muted-foreground">
          {event.entity}{event.entity_id ? ` · ${event.entity_id}` : ''}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Event context</CardTitle>
          <CardDescription>Immutable record (§60) — shown as stored.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-3">
          {row(
            'Actor',
            event.user ? (
              <span>
                {event.user.name || event.user.email}
                <span className="ml-1 font-mono text-xs text-muted-foreground">{event.user.email}</span>
              </span>
            ) : null
          )}
          {row(
            'Workspace',
            event.workspace ? (
              <Link
                to={`/admin-portal/workspaces/${event.workspace.id}`}
                className="underline-offset-4 hover:underline"
              >
                {event.workspace.name}
              </Link>
            ) : null
          )}
          {row('When', new Date(event.created_at).toLocaleString())}
          {row('IP address', event.ip_address)}
          <div className="md:col-span-3">{row('User agent', event.user_agent)}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Changes</CardTitle>
          <CardDescription>Before/after values stored with the event.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-2">
          {jsonBlock('previous_value', event.previous_value)}
          {jsonBlock('new_value', event.new_value)}
        </CardContent>
      </Card>
    </div>
  );
}

export default AdminAuditEventDetailPage;
