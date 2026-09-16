import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Check, Users, Box, Warehouse, Tag, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    period: '/month',
    description: 'Perfect for small side projects & micro teams',
    features: ['Up to 3 Team Members', '50 Master Products', '1 Warehouse Location', 'Basic Inventory Tracking'],
  },
  {
    name: 'Starter',
    price: '$49',
    period: '/month',
    description: 'For growing businesses expanding catalog & sales',
    features: ['Up to 10 Team Members', '1,000 Master Products', '3 Warehouse Locations', 'REST API & Webhooks Access'],
  },
  {
    name: 'Business',
    price: '$149',
    period: '/month',
    popular: true,
    description: 'Advanced multi-warehouse & automated operations',
    features: ['Up to 50 Team Members', '25,000 Master Products', '10 Warehouse Locations', 'Multi-Currency Engine', 'Priority Support'],
  },
  {
    name: 'Enterprise',
    price: '$499',
    period: '/month',
    description: 'Custom scale, dedicated infra & high-frequency sync',
    features: ['Unlimited Team Members', 'Unlimited Products', 'Unlimited Warehouses', 'Custom SLA & Webhooks', 'Dedicated Account Manager'],
  },
];

export function BillingSettingsPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [billingSummary, setBillingSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const loadBilling = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/billing`);
      setBillingSummary(res.data || null);
    } catch (err) {
      console.error('Failed to load billing summary:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBilling();
  }, [activeWorkspace]);

  const handleSelectPlan = async (planName) => {
    if (billingSummary?.plan_tier === planName) return;
    setIsUpdating(true);
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/billing/plan`, { planName });
      await loadBilling();
    } catch (err) {
      toast.error(err.message || 'Failed to update plan');
    } finally {
      setIsUpdating(false);
    }
  };

  const currentPlan = billingSummary?.plan_tier || 'Free';
  const usage = billingSummary?.usage || { users: 1, products: 0, warehouses: 1 };
  const limits = billingSummary?.limits || { maxUsers: 3, maxProducts: 50, maxWarehouses: 1 };

  // ── Coupon redemption (§24/§26): validate via preview, apply via redeem.
  // Pricing/discount come from the server; the client sends only code + plan.
  const [couponCode, setCouponCode] = useState('');
  const [couponPlan, setCouponPlan] = useState('');
  const [couponPreview, setCouponPreview] = useState(null);
  const [couponBusy, setCouponBusy] = useState(false);

  const handleCouponPreview = async () => {
    if (!couponCode.trim()) return;
    setCouponBusy(true);
    setCouponPreview(null);
    try {
      const res = await api.post(`/workspaces/${activeWorkspace.id}/billing/coupons/preview`, {
        code: couponCode.trim(),
        planName: couponPlan || billingSummary?.plan_tier || '',
      });
      setCouponPreview(res);
    } catch (err) {
      toast.error(err.message || 'Coupon validation failed');
    } finally {
      setCouponBusy(false);
    }
  };

  const handleCouponRedeem = async () => {
    if (!couponCode.trim() || !couponPlan) return;
    setCouponBusy(true);
    try {
      const res = await api.post(`/workspaces/${activeWorkspace.id}/billing/coupons/redeem`, {
        code: couponCode.trim(),
        planName: couponPlan,
      });
      toast.success(`Coupon applied — now on ${res.plan_tier ?? 'the new plan'}`);
      setCouponCode('');
      setCouponPreview(null);
      await loadBilling();
    } catch (err) {
      toast.error(err.message || 'Coupon redemption failed');
    } finally {
      setCouponBusy(false);
    }
  };

  // ── Cancellation / resume (§19)
  const [cancelBusy, setCancelBusy] = useState(false);

  const handleCancelAtPeriodEnd = async () => {
    setCancelBusy(true);
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/billing/cancel-at-period-end`);
      toast.success('Cancellation scheduled — access continues until the period ends');
      await loadBilling();
    } catch (err) {
      toast.error(err.message || 'Failed to schedule cancellation');
    } finally {
      setCancelBusy(false);
    }
  };

  const handleResume = async () => {
    setCancelBusy(true);
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/billing/resume`);
      toast.success('Subscription resumed');
      await loadBilling();
    } catch (err) {
      toast.error(err.message || 'Failed to resume subscription');
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stripe Billing & Subscription"
        description="Manage your organization plan tier, usage limits, and Stripe billing engine"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Active Users"
          value={`${usage.users} / ${limits.maxUsers === -1 ? '∞' : limits.maxUsers}`}
          icon={Users}
          isLoading={isLoading}
        />
        <StatCard
          title="Master Products"
          value={`${usage.products} / ${limits.maxProducts === -1 ? '∞' : limits.maxProducts}`}
          icon={Box}
          isLoading={isLoading}
        />
        <StatCard
          title="Warehouses"
          value={`${usage.warehouses} / ${limits.maxWarehouses === -1 ? '∞' : limits.maxWarehouses}`}
          icon={Warehouse}
          isLoading={isLoading}
        />
      </div>

      {/* Subscription state + cancellation (§19) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Subscription status</CardTitle>
          <CardDescription>
            Status: <Badge variant={billingSummary?.status === 'active' ? 'success' : billingSummary?.status === 'past_due' ? 'destructive' : 'secondary'}>{billingSummary?.status ?? 'trialing'}</Badge>
            {billingSummary?.current_period_end
              ? <> · renews {new Date(billingSummary.current_period_end).toLocaleDateString()}</>
              : null}
            {billingSummary?.trial_ends_at
              ? <> · trial ends {new Date(billingSummary.trial_ends_at).toLocaleDateString()}</>
              : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {billingSummary?.status && billingSummary.status !== 'cancelled' && (
            <ConfirmDialog
              title="Cancel subscription?"
              description="Access continues until the end of the current billing period. You can resume before then."
              confirmLabel="Schedule cancellation"
              destructive
              onConfirm={handleCancelAtPeriodEnd}
              trigger={<Button variant="outline" disabled={cancelBusy}>Cancel at period end</Button>}
            />
          )}
          {billingSummary?.status === 'past_due' && (
            <Button variant="outline" disabled={cancelBusy} onClick={handleResume}>
              <XCircle className="mr-2 h-4 w-4" /> Resume / clear pending cancel
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Coupon redemption (§24/§26) — pricing is server-side only */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Tag className="h-4 w-4" /> Redeem a coupon</CardTitle>
          <CardDescription>Apply a discount or plan-access code to upgrade this workspace. Amounts are calculated on the server.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              placeholder="Coupon code (e.g. WELCOME-2026)"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
              aria-label="Coupon code"
            />
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm sm:w-48"
              value={couponPlan}
              onChange={(e) => setCouponPlan(e.target.value)}
              aria-label="Target plan"
            >
              <option value="">Choose plan…</option>
              {PLANS.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={handleCouponPreview} disabled={couponBusy || !couponCode.trim() || !couponPlan}>
              Check code
            </Button>
          </div>
          {couponPreview?.valid && (
            <div className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">
              <div className="font-medium">
                {couponPreview.coupon?.discount_type === 'PERCENTAGE' && `${couponPreview.coupon?.discount_value}% off`}
                {couponPreview.coupon?.discount_type === 'FIXED_AMOUNT' && `${couponPreview.pricing?.currency} ${couponPreview.coupon?.discount_value} off`}
                {(couponPreview.coupon?.discount_type === 'FULL_DISCOUNT' || couponPreview.coupon?.discount_type === 'PLAN_ACCESS') && 'Full plan access'}
                {' — '}
                {couponPreview.pricing?.finalAmount === 0 ? 'free' : `${couponPreview.pricing?.currency ?? ''} ${couponPreview.pricing?.finalAmount}`}
              </div>
              <Button className="mt-2" onClick={handleCouponRedeem} disabled={couponBusy || !couponPlan}>
                Apply coupon
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((plan) => {
          const isCurrent = currentPlan.toLowerCase() === plan.name.toLowerCase();
          return (
            <Card key={plan.name} className={isCurrent ? 'border-primary' : undefined}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-xl font-extrabold">{plan.name}</CardTitle>
                  {isCurrent ? (
                    <Badge variant="success">Current Plan</Badge>
                  ) : plan.popular ? (
                    <Badge>Most Popular</Badge>
                  ) : null}
                </div>
                <CardDescription className="min-h-9">{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black tracking-tight">{plan.price}</span>
                  <span className="text-[13px] text-muted-foreground">{plan.period}</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {plan.features.map((feat, i) => (
                    <div key={i} className="flex items-center gap-2 text-[13px]">
                      <Check className="h-4 w-4 shrink-0 text-success" />
                      {feat}
                    </div>
                  ))}
                </div>
                {isCurrent ? (
                  <Button variant="secondary" disabled className="w-full">
                    Current Tier
                  </Button>
                ) : (
                  <ConfirmDialog
                    title={`Switch to ${plan.name}?`}
                    description={`Are you sure you want to switch your subscription plan to ${plan.name}?`}
                    confirmLabel={`Switch to ${plan.name}`}
                    destructive={false}
                    onConfirm={() => handleSelectPlan(plan.name)}
                    trigger={
                      <Button disabled={isUpdating} className="w-full">
                        {`Switch to ${plan.name}`}
                      </Button>
                    }
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
