import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Check, Users, Box, Warehouse } from 'lucide-react';
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
