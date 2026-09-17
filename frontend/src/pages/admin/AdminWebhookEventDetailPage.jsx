import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { api } from '../../lib/api';
import { ArrowLeft, RefreshCw, Webhook } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/sonner';

/**
 * §69 webhook-event micro-detail: safe event fields + the stored Stripe
 * payload (same data Stripe sent — no secrets), plus the retry action for
 * failed events.
 */
export function AdminWebhookEventDetailPage() {
  const { eventId } = useParams();
  const [event, setEvent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/admin/webhook-events/${eventId}`);
      setEvent(res.data || null);
    } catch (err) {
      setError(err.message || 'Failed to load webhook event');
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRetry = async () => {
    try {
      const res = await api.post(`/admin/webhook-events/${event.id}/retry`);
      toast.success(`Retry result: ${res.data?.status || 'completed'}`);
      await load();
    } catch (err) {
      toast.error(err.message || 'Retry failed');
    }
  };

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
        <p className="text-sm text-destructive">{error || 'Event not found'}</p>
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

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
            <Link to="/admin-portal">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Admin portal
            </Link>
          </Button>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Webhook className="h-6 w-6" /> {event.event_type}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">{event.event_id}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={event.processing_status === 'processed' ? 'success' : event.processing_status === 'failed' ? 'destructive' : 'secondary'}>
            {event.processing_status}
          </Badge>
          {event.processing_status === 'failed' && (
            <Button variant="outline" size="sm" onClick={handleRetry}>
              Retry event
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Processing details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-3">
          {row('Processing status', event.processing_status)}
          {row('Duration', event.processing_duration_ms != null ? `${event.processing_duration_ms} ms` : null)}
          {row('Delivery attempt', event.delivery_attempt)}
          {row('Stripe event created', event.stripe_event_created ? new Date(event.stripe_event_created).toLocaleString() : null)}
          {row('Received', new Date(event.created_at).toLocaleString())}
          {row('Detail', event.detail)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Stored payload</CardTitle>
          <CardDescription>The exact event data Stripe delivered (no credentials). Retry re-dispatches this payload through the idempotent handler.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 font-mono text-xs">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

export default AdminWebhookEventDetailPage;
