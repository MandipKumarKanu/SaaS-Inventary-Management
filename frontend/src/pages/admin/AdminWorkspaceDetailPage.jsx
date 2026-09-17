import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { api } from '../../lib/api';
import {
  Building2,
  Users,
  Box,
  Warehouse,
  CreditCard,
  ArrowLeft,
  RefreshCw,
  Activity,
  Tag,
  Stethoscope,
  History,
  Receipt,
  ReceiptText,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, LoadingState } from '@/components/common/DataTable';
import { StatCard } from '@/components/common/StatCard';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';

/**
 * Admin workspace detail (PRD §47, §48, §50, §57, §73):
 *
 *   Overview → Subscription → Members → Usage → Billing → Events → Diagnostics
 *
 * Every mutation is a reason-required dialog (§48) hitting the audited admin
 * endpoints. Server remains the authorization + business-rule authority (§83);
 * this page only renders what the backend reports.
 */

const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled', 'suspended'];

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function formatMoney(amount, currency = 'USD') {
  if (amount == null) return '—';
  return `${currency} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Reason-required action dialog shared by all admin mutations (§48).
 *  Optional `children` render extra inputs (e.g. the plan picker); the
 *  confirm button stays disabled until `canConfirm` passes. */
function ReasonActionDialog({ open, onOpenChange, title, description, confirmLabel, destructive = false, onConfirm, children, canConfirm }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const submit = async () => {
    if (reason.trim().length < 3) {
      toast.error('A reason of at least 3 characters is required.');
      return;
    }
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (stored in the audit log)…"
          aria-label="Action reason"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={submit}
            disabled={busy || reason.trim().length < 3 || canConfirm === false}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

export function AdminWorkspaceDetailPage() {
  const { workspaceId } = useParams();

  const [detail, setDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('subscription');

  // Payments (§56)
  const [payments, setPayments] = useState([]);
  const [isPaymentsLoading, setIsPaymentsLoading] = useState(false);
  // Diagnostics (§73)
  const [diagnostics, setDiagnostics] = useState(null);
  const [isDiagnosticsLoading, setIsDiagnosticsLoading] = useState(false);

  // Action dialogs
  const [action, setAction] = useState(null); // 'extend-trial' | 'change-plan' | 'cancel' | 'reactivate' | 'override'
  const [newPlanName, setNewPlanName] = useState('');
  const [planOptions, setPlanOptions] = useState([]);
  const [overrideType, setOverrideType] = useState('feature_grant');
  const [overrideFeature, setOverrideFeature] = useState('');
  const [overrideExpiresAt, setOverrideExpiresAt] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideBusy, setOverrideBusy] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!workspaceId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/admin/workspaces/${workspaceId}`);
      setDetail(res.data || null);
    } catch (err) {
      setError(err.message || 'Failed to load workspace');
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  const loadPayments = useCallback(async () => {
    if (!workspaceId) return;
    setIsPaymentsLoading(true);
    try {
      const res = await api.get(`/admin/workspaces/${workspaceId}/payments`);
      setPayments(res.data || []);
    } catch {
      // Billing view permission missing — section renders its empty state.
      setPayments([]);
    } finally {
      setIsPaymentsLoading(false);
    }
  }, [workspaceId]);

  const loadDiagnostics = useCallback(async () => {
    if (!workspaceId) return;
    setIsDiagnosticsLoading(true);
    try {
      const res = await api.get(`/admin/workspaces/${workspaceId}/diagnostics`);
      setDiagnostics(res.data || null);
    } catch {
      setDiagnostics(null);
    } finally {
      setIsDiagnosticsLoading(false);
    }
  }, [workspaceId]);

  const fetchPlanOptions = useCallback(async () => {
    try {
      // Plans are public catalog data for authenticated admins; resolve via
      // the billing summary of any workspace is wrong here, so use the
      // subscription detail's sibling endpoint: the plan list is embedded in
      // the overview payload. Fall back gracefully if unavailable.
      const res = await api.get('/admin/overview');
      const names = new Set(
        (res.data?.subscriptions ?? []).map((s) => s.plan_name).filter(Boolean)
      );
      setPlanOptions(Array.from(names));
    } catch {
      setPlanOptions([]);
    }
  }, []);

  useEffect(() => {
    loadDetail();
    loadPayments();
    fetchPlanOptions();
  }, [loadDetail, loadPayments, fetchPlanOptions]);

  useEffect(() => {
    if (activeTab === 'diagnostics' && !diagnostics) loadDiagnostics();
  }, [activeTab, diagnostics, loadDiagnostics]);

  const runAction = async (fn, successMessage) => {
    try {
      await fn();
      toast.success(successMessage);
      setAction(null);
      await loadDetail();
    } catch (err) {
      toast.error(err.message || 'Action failed');
    }
  };

  const handleExtendTrial = (reason) =>
    runAction(
      () => api.post(`/admin/workspaces/${workspaceId}/subscription/extend-trial`, { days: 14, reason }),
      'Trial extended by 14 days'
    );

  const handleChangePlan = (reason) =>
    runAction(
      () => api.post(`/admin/workspaces/${workspaceId}/subscription/change-plan`, { planName: newPlanName, reason }),
      `Plan changed to ${newPlanName}`
    );

  const handleCancel = (reason) =>
    runAction(
      () => api.post(`/admin/workspaces/${workspaceId}/subscription/cancel`, { reason }),
      'Subscription cancelled'
    );

  const handleReactivate = (reason) =>
    runAction(
      () => api.post(`/admin/workspaces/${workspaceId}/subscription/reactivate`, { reason }),
      'Subscription reactivated'
    );

  const handleOverride = async () => {
    if (overrideType === 'feature_grant' && !overrideFeature.trim()) {
      toast.error('Feature key is required for a feature grant.');
      return;
    }
    if (!overrideExpiresAt) {
      toast.error('Overrides must have an expiry.');
      return;
    }
    if (overrideReason.trim().length < 3) {
      toast.error('A reason of at least 3 characters is required.');
      return;
    }
    setOverrideBusy(true);
    try {
      await api.post(`/admin/workspaces/${workspaceId}/subscription/overrides`, {
        override_type: overrideType,
        value: overrideType === 'feature_grant' ? { feature: overrideFeature.trim() } : {},
        reason: overrideReason.trim(),
        expires_at: new Date(overrideExpiresAt).toISOString(),
      });
      toast.success('Override added');
      setAction(null);
      setOverrideReason('');
      await loadDetail();
    } catch (err) {
      toast.error(err.message || 'Failed to add override');
    } finally {
      setOverrideBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoadingState message="Loading workspace…" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error || 'Workspace not found.'}</p>
        <Button variant="outline" asChild>
          <Link to="/admin-portal">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to admin portal
          </Link>
        </Button>
      </div>
    );
  }

  const { workspace, members, subscription, usage, coupon_redemptions, recent_activity } = detail;
  const sub = subscription;
  const plan = sub?.plan ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={workspace.name}
        description={`Tenant workspace · slug ${workspace.slug} · created ${formatDate(workspace.created_at)}`}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin-portal">
                <ArrowLeft className="mr-2 h-4 w-4" /> Portal
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={loadDetail} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </>
        }
      />

      {/* Overview stat cards (§47) */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Workspace status" value={workspace.status} icon={Building2} isLoading={isLoading} />
        <StatCard
          title="Plan"
          value={plan?.display_name || plan?.name || 'Free'}
          icon={CreditCard}
          badge={sub ? sub.status : undefined}
          isLoading={isLoading}
        />
        <StatCard title="Members" value={usage.members} icon={Users} isLoading={isLoading} />
        <StatCard title="Products" value={usage.products} icon={Box} isLoading={isLoading} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 md:w-auto md:grid-cols-6">
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="billing" className="gap-1.5"><Receipt className="h-4 w-4" /> Billing</TabsTrigger>
          <TabsTrigger value="events" className="gap-1.5"><History className="h-4 w-4" /> Events</TabsTrigger>
          <TabsTrigger value="diagnostics" className="gap-1.5"><Stethoscope className="h-4 w-4" /> Diagnostics</TabsTrigger>
        </TabsList>

        {/* SUBSCRIPTION (§50) */}
        <TabsContent value="subscription" className="mt-6 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Current state</CardTitle>
              <CardDescription>Full lifecycle of this workspace's subscription.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {!sub ? (
                <p className="text-sm text-muted-foreground">No subscription row for this workspace.</p>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Detail label="Plan">{plan?.display_name || plan?.name || '—'}</Detail>
                    <Detail label="Status"><StatusBadge status={sub.status} /></Detail>
                    <Detail label="Billing interval">{sub.billing_interval ?? '—'}</Detail>
                    <Detail label="Trial ends">{formatDate(sub.trial_ends_at)}</Detail>
                    <Detail label="Current period">{formatDate(sub.current_period_start)} → {formatDate(sub.current_period_end)}</Detail>
                    <Detail label="Grace ends">{formatDate(sub.grace_ends_at)}</Detail>
                    <Detail label="Cancel at period end">{sub.cancel_at_period_end ? 'Yes' : 'No'}</Detail>
                    <Detail label="Expires">{formatDate(sub.expires_at)}</Detail>
                    <Detail label="Cancelled">{formatDate(sub.cancelled_at)}</Detail>
                  </div>
                  <div className="flex flex-wrap gap-3 border-t pt-4">
                    {sub.status === 'trialing' && (
                      <Button variant="outline" size="sm" onClick={() => setAction('extend-trial')}>
                        Extend trial (+14 days)
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setAction('change-plan')}>
                      Change plan
                    </Button>
                    {['active', 'trialing', 'past_due'].includes(sub.status) && (
                      <ConfirmDialog
                        title="Cancel this subscription?"
                        description="The subscription will be cancelled immediately. This action is audited and requires a reason."
                        confirmLabel="Cancel subscription"
                        destructive
                        onConfirm={() => setAction('cancel')}
                        trigger={<Button variant="destructive" size="sm">Cancel subscription</Button>}
                      />
                    )}
                    {sub.status === 'cancelled' && (
                      <Button variant="outline" size="sm" onClick={() => setAction('reactivate')}>
                        Reactivate
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setAction('override')}>
                      Add override
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Coupon redemptions (§47 coupons) */}
          <Card className="overflow-hidden p-0">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-base flex items-center gap-2"><Tag className="h-4 w-4" /> Coupon redemptions</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {coupon_redemptions.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-muted-foreground">No coupons redeemed for this workspace.</p>
              ) : (
                <DataTable
                  head={
                    <>
                      <TableHead>Coupon</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Operation</TableHead>
                      <TableHead>Discount</TableHead>
                      <TableHead>Final</TableHead>
                      <TableHead>Date</TableHead>
                    </>
                  }
                  isEmpty={false}
                  isLoading={false}
                  colSpan={6}
                  columns={6}
                >
                  {coupon_redemptions.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono font-bold">{r.coupon?.code ?? '—'}</TableCell>
                      <TableCell>{r.coupon?.discount_type?.replace('_', ' ') ?? '—'}</TableCell>
                      <TableCell className="capitalize">{r.operation?.replace('_', ' ')}</TableCell>
                      <TableCell className="font-mono text-xs">-{formatMoney(r.discount_amount, r.currency)}</TableCell>
                      <TableCell className="font-mono text-xs">{formatMoney(r.final_amount, r.currency)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(r.redeemed_at)}</TableCell>
                    </TableRow>
                  ))}
                </DataTable>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MEMBERS (§47) */}
        <TabsContent value="members" className="mt-6 flex flex-col gap-6">
          <Card className="overflow-hidden p-0">
            <DataTable
              head={
                <>
                  <TableHead>Member</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Member status</TableHead>
                  <TableHead>Account status</TableHead>
                  <TableHead>Joined</TableHead>
                </>
              }
              isLoading={false}
              isEmpty={members.length === 0}
              emptyTitle="No members"
              emptyDescription="This workspace has no members yet."
              colSpan={6}
              columns={6}
            >
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-bold">{m.name || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{m.email}</TableCell>
                  <TableCell>{m.role_name ? <Badge variant="outline">{m.role_name}</Badge> : '—'}</TableCell>
                  <TableCell><StatusBadge status={m.status} /></TableCell>
                  <TableCell>{m.user_status ? <StatusBadge status={m.user_status} /> : '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(m.created_at)}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </Card>
        </TabsContent>

        {/* USAGE (§47) */}
        <TabsContent value="usage" className="mt-6 flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Members" value={usage.members} icon={Users} />
            <StatCard title="Products" value={usage.products} icon={Box} />
            <StatCard title="Warehouses" value={usage.warehouses} icon={Warehouse} />
            <StatCard
              title="Transactions (month)"
              value={usage.usage_records?.transactions_per_month ?? 0}
              icon={Activity}
            />
          </div>
          {plan?.limits && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Plan limits</CardTitle>
                <CardDescription>Entitlements from the workspace's current plan.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(plan.limits).map(([metric, limit]) => (
                    <Detail key={metric} label={metric.replace(/_/g, ' ')}>
                      {Number(limit) === -1 ? 'Unlimited' : String(limit)}
                    </Detail>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* BILLING (§56/§57) */}
        <TabsContent value="billing" className="mt-6 flex flex-col gap-6">
          <Card className="overflow-hidden p-0">
            <DataTable
              head={
                <>
                  <TableHead>Reference</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Failure reason</TableHead>
                  <TableHead>Date</TableHead>
                </>
              }
              isLoading={isPaymentsLoading}
              isEmpty={!isPaymentsLoading && payments.length === 0}
              emptyTitle="No payments"
              emptyDescription="No payments recorded — payments persist from Stripe billing events."
              colSpan={7}
              columns={7}
            >
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.provider_reference}</TableCell>
                  <TableCell className="capitalize">{p.provider}</TableCell>
                  <TableCell className="font-mono text-xs font-bold">{formatMoney(p.amount, p.currency)}</TableCell>
                  <TableCell>
                    <Badge variant={p.status === 'successful' ? 'success' : p.status === 'failed' ? 'destructive' : p.status === 'refunded' ? 'secondary' : 'outline'}>
                      {p.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.invoice_id ?? '—'}</TableCell>
                  <TableCell className="max-w-48 truncate text-xs text-muted-foreground">{p.failure_reason ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(p.created_at)}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </Card>
        </TabsContent>

        {/* EVENTS (§50 history) */}
        <TabsContent value="events" className="mt-6 flex flex-col gap-6">
          <Card className="overflow-hidden p-0">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-base">Recent workspace activity</CardTitle>
              <CardDescription>Audit trail for this tenant (latest 15 entries).</CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <AuditActivityTable activity={recent_activity} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* DIAGNOSTICS (§73) */}
        <TabsContent value="diagnostics" className="mt-6 flex flex-col gap-6">
          {!diagnostics ? (
            <Card>
              <CardContent className="flex flex-col items-start gap-3 py-6">
                <p className="text-sm text-muted-foreground">
                  {isDiagnosticsLoading ? 'Loading diagnostics…' : 'Diagnostics could not be loaded.'}
                </p>
                <Button variant="outline" size="sm" onClick={loadDiagnostics} disabled={isDiagnosticsLoading}>
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Stethoscope className="h-5 w-5" /> Access decision</CardTitle>
                <CardDescription>Read-only explanation of the effective access. Admins cannot bypass business rules here.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Detail label="Effective access">
                    <Badge variant={diagnostics.access.effective_access === 'allowed' ? 'success' : diagnostics.access.effective_access === 'restricted' ? 'secondary' : 'destructive'}>
                      {diagnostics.access.effective_access}
                    </Badge>
                  </Detail>
                  <Detail label="Plan">{diagnostics.plan?.display_name || diagnostics.plan?.name || '—'}</Detail>
                  <Detail label="Subscription status">{diagnostics.subscription?.status ?? '—'}</Detail>
                  <Detail label="Expires">{formatDate(diagnostics.subscription?.expires_at)}</Detail>
                  <Detail label="Grace ends">{formatDate(diagnostics.subscription?.grace_ends_at)}</Detail>
                  <Detail label="Cancel at period end">{diagnostics.subscription?.cancel_at_period_end ? 'Yes' : 'No'}</Detail>
                </div>
                <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                  {diagnostics.access.explanation}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Feature entitlements</h4>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(diagnostics.access.features ?? {}).map(([feature, enabled]) => (
                        <Badge key={feature} variant={enabled ? 'success' : 'outline'}>
                          {feature.replace(/_/g, ' ')}: {enabled ? 'on' : 'off'}
                        </Badge>
                      ))}
                      {Object.keys(diagnostics.access.features ?? {}).length === 0 && (
                        <span className="text-sm text-muted-foreground">No features recorded.</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Limits</h4>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(diagnostics.access.limits ?? {}).map(([limit, value]) => (
                        <Badge key={limit} variant="outline">
                          {limit.replace(/_/g, ' ')}: {Number(value) === -1 ? 'unlimited' : String(value)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Action dialogs (§48) ── */}
      <ReasonActionDialog
        open={action === 'extend-trial'}
        onOpenChange={(o) => !o && setAction(null)}
        title="Extend trial"
        description="Adds 14 days to the running trial. The reason is stored in the audit log."
        confirmLabel="Extend trial"
        onConfirm={handleExtendTrial}
      />
      <ReasonActionDialog
        open={action === 'change-plan'}
        onOpenChange={(o) => !o && setAction(null)}
        title="Change plan"
        description="Plan changes are blocked in Stripe mode — use checkout/portal there. The reason is audited."
        confirmLabel="Change plan"
        canConfirm={Boolean(newPlanName)}
      >
        <select
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={newPlanName}
          onChange={(e) => setNewPlanName(e.target.value)}
          aria-label="New plan"
        >
          <option value="">Choose plan…</option>
          {planOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </ReasonActionDialog>
      <ReasonActionDialog
        open={action === 'cancel'}
        onOpenChange={(o) => !o && setAction(null)}
        title="Cancel subscription"
        description="Immediate cancellation. Access ends subject to the platform's grace rules. The reason is audited."
        confirmLabel="Cancel subscription"
        destructive
        onConfirm={handleCancel}
      />
      <ReasonActionDialog
        open={action === 'reactivate'}
        onOpenChange={(o) => !o && setAction(null)}
        title="Reactivate subscription"
        description="Restores a cancelled subscription (dev mode only). The reason is audited."
        confirmLabel="Reactivate"
        onConfirm={handleReactivate}
      />
      <Dialog open={action === 'override'} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add administrative override</DialogTitle>
            <DialogDescription>
              Temporary, auto-expiring exception (§36). The subscription itself is never silently modified.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <select
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={overrideType}
              onChange={(e) => setOverrideType(e.target.value)}
              aria-label="Override type"
            >
              <option value="feature_grant">Feature grant</option>
              <option value="trial_extension">Trial extension</option>
              <option value="subscription_extension">Subscription extension</option>
              <option value="limit_increase">Limit increase</option>
            </select>
            {overrideType === 'feature_grant' && (
              <input
                className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
                placeholder="Feature key (e.g. forecasting)"
                value={overrideFeature}
                onChange={(e) => setOverrideFeature(e.target.value)}
                aria-label="Feature key"
              />
            )}
            <input
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
              type="datetime-local"
              value={overrideExpiresAt}
              onChange={(e) => setOverrideExpiresAt(e.target.value)}
              aria-label="Expires at"
            />
            <Textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Reason (stored in the audit log)…"
              aria-label="Override reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={overrideBusy}>Cancel</Button>
            <Button onClick={handleOverride} disabled={overrideBusy}>Add override</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AuditActivityTable({ activity }) {
  if (!activity || activity.length === 0) {
    return <p className="px-4 pb-4 text-sm text-muted-foreground">No recent activity.</p>;
  }
  return (
    <DataTable
      head={
        <>
          <TableHead>Timestamp</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Entity</TableHead>
        </>
      }
      isLoading={false}
      isEmpty={false}
      colSpan={4}
      columns={4}
    >
      {activity.map((a) => (
        <TableRow key={a.id}>
          <TableCell className="font-mono text-xs text-muted-foreground">{formatDate(a.created_at)}</TableCell>
          <TableCell className="text-xs">{a.user?.email ?? 'System'}</TableCell>
          <TableCell className="font-mono text-xs font-bold text-primary">{a.action}</TableCell>
          <TableCell className="text-xs">{a.entity}{a.entity_id ? ` · ${String(a.entity_id).slice(0, 8)}` : ''}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}
