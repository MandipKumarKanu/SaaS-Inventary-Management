import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { api } from '../../lib/api';
import { ArrowLeft, RefreshCw, CreditCard } from 'lucide-react';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/sonner';

/**
 * §69 Payment detail: full drill-in for a single payment — workspace,
 * subscription and coupon context, plus the refund action (reason- and
 * re-auth-gated). Never renders secrets or metadata blobs.
 */
export function AdminPaymentDetailPage() {
  const { paymentId } = useParams();
  const [payment, setPayment] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/admin/payments/${paymentId}`);
      setPayment(res.data || null);
    } catch (err) {
      setError(err.message || 'Failed to load payment');
    } finally {
      setIsLoading(false);
    }
  }, [paymentId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefund = async () => {
    const reason = window.prompt('Refund reason (required):');
    if (!reason || reason.trim().length < 3) return;
    const password = window.prompt('Re-enter your password to confirm this dangerous operation:');
    if (!password) return;
    try {
      await api.post(
        `/admin/payments/${payment.id}/refund`,
        { reason: reason.trim() },
        { headers: { 'x-admin-password': password } }
      );
      toast.success('Refund issued');
      await load();
    } catch (err) {
      toast.error(err.message || 'Refund failed');
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

  if (error || !payment) {
    return (
      <div className="flex flex-col items-start gap-4 p-6">
        <p className="text-sm text-destructive">{error || 'Payment not found'}</p>
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
            <CreditCard className="h-6 w-6" /> Payment {payment.currency} {Number(payment.amount).toFixed(2)}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">{payment.provider_reference || payment.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={payment.status} />
          {payment.status === 'successful' && (
            <ConfirmDialog
              title={`Refund ${payment.currency} ${Number(payment.amount).toFixed(2)}?`}
              description="This issues a Stripe refund and marks the payment refunded. The action is audited."
              confirmLabel="Issue refund"
              destructive
              onConfirm={handleRefund}
              trigger={
                <Button variant="destructive" size="sm">
                  Refund
                </Button>
              }
            />
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Payment details</CardTitle>
          <CardDescription>Provider references are shown; sensitive credentials are never returned by the API.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-3">
          {row('Amount', `${payment.currency} ${Number(payment.amount).toFixed(2)}`)}
          {row('Status', payment.status)}
          {row('Provider', payment.provider)}
          {row('Provider reference', payment.provider_reference)}
          {row('Invoice', payment.invoice_id)}
          {row(
            'Coupon discount',
            payment.discount_amount
              ? `${payment.currency} ${Number(payment.discount_amount).toFixed(2)}${payment.coupon?.code ? ` (${payment.coupon.code})` : ''}`
              : null
          )}
          {row('Failure reason', payment.failure_reason)}
          {row('Created', new Date(payment.created_at).toLocaleString())}
          {row('Updated', new Date(payment.updated_at).toLocaleString())}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Relationships</CardTitle>
          <CardDescription>Navigate to the related entities (§69 linked detail views).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">Workspace</div>
            {payment.workspace?.id ? (
              <Link
                to={`/admin-portal/workspaces/${payment.workspace.id}`}
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                {payment.workspace.name}
              </Link>
            ) : (
              '—'
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Subscription</div>
            {payment.subscription ? (
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{String(payment.subscription.id).slice(0, 8)}…</span>
                <Badge variant="outline">{payment.subscription.status}</Badge>
              </div>
            ) : (
              '—'
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Coupon</div>
            {payment.coupon?.code ? (
              <Badge variant="outline" className="font-mono">
                {payment.coupon.code}
              </Badge>
            ) : (
              '—'
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default AdminPaymentDetailPage;
