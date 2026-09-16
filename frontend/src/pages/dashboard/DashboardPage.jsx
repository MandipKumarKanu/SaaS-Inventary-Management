import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Package, Warehouse, AlertTriangle, DollarSign, Sparkles, ArrowUpRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/common/StatCard';
import { EmptyState } from '@/components/common/EmptyState';

const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  color: 'var(--color-card-foreground)',
  fontSize: '12px',
};

const AXIS_TICK = { fill: 'var(--color-muted-foreground)', fontSize: 12 };

export function DashboardPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [stats, setStats] = useState({
    productsCount: 0,
    warehousesCount: 0,
    totalValuation: 0,
    lowStockCount: 0,
  });
  const [recentLogs, setRecentLogs] = useState([]);
  const [movementData, setMovementData] = useState([]);
  const [warehouseDistData, setWarehouseDistData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Bucket inventory movements into the last 7 calendar days:
  // received = inbound units, shipped = outbound units per day.
  function buildMovementTrend(transactions) {
    const days = [];
    const buckets = new Map();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { weekday: 'short' });
      buckets.set(key, { name: label, received: 0, shipped: 0 });
      days.push(key);
    }
    for (const tx of transactions || []) {
      if (!tx?.created_at) continue;
      const key = new Date(tx.created_at).toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      const qty = Number(tx.qty_change) || 0;
      if (qty > 0) bucket.received += qty;
      else bucket.shipped += Math.abs(qty);
    }
    return days.map((k) => buckets.get(k));
  }

  // Aggregate on-hand units per warehouse facility.
  function buildWarehouseDistribution(inventory) {
    const totals = new Map();
    for (const inv of inventory || []) {
      const name = inv.warehouse?.name || inv.warehouse?.code || 'Unassigned';
      totals.set(name, (totals.get(name) || 0) + (Number(inv.quantity) || 0));
    }
    return [...totals.entries()]
      .map(([name, stock]) => ({ name, stock }))
      .sort((a, b) => b.stock - a.stock)
      .slice(0, 6);
  }

  useEffect(() => {
    if (!activeWorkspace) return;

    async function loadDashboardData() {
      setIsLoading(true);
      try {
        const [prodRes, whRes, invRes, auditRes, txRes] = await Promise.allSettled([
          api.get(`/workspaces/${activeWorkspace.id}/products?pageSize=1`),
          api.get(`/workspaces/${activeWorkspace.id}/warehouses`),
          api.get(`/workspaces/${activeWorkspace.id}/inventory`),
          api.get(`/workspaces/${activeWorkspace.id}/audit-logs?pageSize=5`),
          api.get(`/workspaces/${activeWorkspace.id}/inventory/transactions?pageSize=500`),
        ]);

        const productsCount = prodRes.status === 'fulfilled' ? (prodRes.value.meta?.total ?? (prodRes.value.data?.length || 0)) : 0;
        const warehouses = whRes.status === 'fulfilled' ? (whRes.value.data || []) : [];
        const inventory = invRes.status === 'fulfilled' ? (invRes.value.data || []) : [];
        const logs = auditRes.status === 'fulfilled' ? (auditRes.value.data || []) : [];
        const transactions = txRes.status === 'fulfilled' ? (txRes.value.data || []) : [];

        // Calculate valuation and low stock count
        let totalValuation = 0;
        let lowStockCount = 0;

        inventory.forEach((inv) => {
          const cost = parseFloat(inv.product?.cost_price || 0);
          totalValuation += inv.quantity * cost;
          const reorder = inv.product?.reorder_point || 10;
          if (inv.quantity <= reorder) {
            lowStockCount++;
          }
        });

        setStats({
          productsCount,
          warehousesCount: warehouses.length,
          totalValuation,
          lowStockCount,
        });
        setRecentLogs(logs);
        setMovementData(buildMovementTrend(transactions));
        setWarehouseDistData(buildWarehouseDistribution(inventory));
      } catch (err) {
        console.error('Failed to load dashboard metrics:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadDashboardData();
  }, [activeWorkspace]);

  if (!activeWorkspace) {
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState
            icon={Package}
            title="No active workspace"
            description="Select or create a workspace to view dashboard metrics."
          />
        </CardContent>
      </Card>
    );
  }

  const statCards = [
    {
      title: 'Total Valuation',
      value: `$${stats.totalValuation.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      icon: DollarSign,
      badge: 'Asset Value',
    },
    { title: 'Master SKUs', value: stats.productsCount, icon: Package, badge: 'Catalog' },
    { title: 'Warehouses', value: stats.warehousesCount, icon: Warehouse, badge: 'Facilities' },
    { title: 'Low Stock Alerts', value: stats.lowStockCount, icon: AlertTriangle, badge: 'Action Needed' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Warehouse className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <Badge className="mb-2">
                <Sparkles className="h-3 w-3" />
                Phase 2: Inventory Core Engine
              </Badge>
              <h1 className="truncate text-2xl font-extrabold tracking-tight text-foreground">
                {activeWorkspace.name}
              </h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Live SKU analytics, immutable ledger transactions, and multi-warehouse balances
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" asChild>
              <a href="/products">
                <Package />
                Products
              </a>
            </Button>
            <Button asChild>
              <a href="/inventory">
                Stock Balances
                <ArrowUpRight />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <StatCard
            key={card.title}
            title={card.title}
            value={card.value}
            icon={card.icon}
            badge={card.badge}
            isLoading={isLoading}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Stock Movement Trends</CardTitle>
              <CardDescription>Received vs shipped inventory volume over the last 7 days</CardDescription>
            </div>
            <Badge>Live</Badge>
          </CardHeader>
          <CardContent>
            {movementData.every((d) => d.received === 0 && d.shipped === 0) && !isLoading ? (
              <p className="py-10 text-center text-[13px] text-muted-foreground">
                No stock movements recorded in the last 7 days.
              </p>
            ) : (
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={movementData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} width={40} />
                    <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} />
                    <Area
                      type="monotone"
                      dataKey="received"
                      name="Received"
                      stroke="var(--color-chart-2)"
                      strokeWidth={2}
                      fill="var(--color-chart-2)"
                      fillOpacity={0.15}
                    />
                    <Area
                      type="monotone"
                      dataKey="shipped"
                      name="Shipped"
                      stroke="var(--color-chart-1)"
                      strokeWidth={2}
                      fill="var(--color-chart-1)"
                      fillOpacity={0.15}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Warehouse Stock</CardTitle>
            <CardDescription>Stock distribution per facility</CardDescription>
          </CardHeader>
          <CardContent>
            {warehouseDistData.length === 0 && !isLoading ? (
              <p className="py-10 text-center text-[13px] text-muted-foreground">
                No on-hand stock to distribute yet.
              </p>
            ) : (
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={warehouseDistData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} width={40} />
                    <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} />
                    <Bar dataKey="stock" name="Stock Units" fill="var(--color-chart-5)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest audit events in this workspace</CardDescription>
        </CardHeader>
        <CardContent>
          {recentLogs.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-muted-foreground">
              {isLoading ? 'Loading activity…' : 'No recent activity.'}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {recentLogs.map((log, idx) => (
                <li key={log.id ?? idx} className="flex items-center justify-between gap-3 py-3">
                  <span className="truncate text-sm text-foreground">
                    {log.action ?? log.event ?? log.message ?? 'Workspace event'}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {log.created_at ? new Date(log.created_at).toLocaleString() : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
