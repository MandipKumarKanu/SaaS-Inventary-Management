import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { ShoppingCart, ShoppingBag, Truck, RefreshCw, Power, Zap } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LoadingState } from '@/components/common/DataTable';
import { ErrorState } from '@/components/common/ErrorState';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';

const INTEGRATION_PROVIDERS = [
  {
    id: 'shopify',
    name: 'Shopify Store',
    category: 'E-Commerce Marketplace',
    icon: ShoppingBag,
    description: 'Sync online store products, inventory levels, and real-time customer orders automatically',
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce Store',
    category: 'WordPress E-Commerce',
    icon: ShoppingCart,
    description: 'Bi-directional inventory sync and order fulfillment updates for WooCommerce sites',
  },
  {
    id: 'amazon',
    name: 'Amazon Seller Central',
    category: 'Global Marketplace',
    icon: Zap,
    description: 'FBA and FBM inventory tracking, Amazon ASIN mapping, and automated order imports',
  },
  {
    id: 'easypost',
    name: 'EasyPost Multi-Carrier API',
    category: 'Shipping & Logistics',
    icon: Truck,
    description: 'Generate shipping labels, compare FedEx, UPS, DHL rates, and track packages in real-time',
  },
];

export function IntegrationsHubPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [connections, setConnections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncingProvider, setSyncingProvider] = useState(null);
  const [pendingDisconnect, setPendingDisconnect] = useState(null);

  const loadConnections = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/integrations`);
      setConnections(res.data || []);
    } catch (err) {
      console.error('Failed to load integrations:', err);
      setError(err.message || 'Failed to load integrations');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadConnections();
  }, [activeWorkspace]);

  const handleToggleConnect = async (provider, providerName) => {
    const existing = connections.find((c) => c.provider === provider && c.status === 'active');

    try {
      if (existing) {
        setPendingDisconnect({ provider, providerName });
        return;
      }
      await api.post(`/workspaces/${activeWorkspace.id}/integrations/connect`, {
        provider,
        name: `${providerName} Production`,
        credentials: { api_key: 'connected_live' },
      });
      toast.success(`${providerName} connected successfully`);
      loadConnections();
    } catch (err) {
      toast.error(err.message || 'Action failed');
    }
  };

  const handleConfirmDisconnect = async () => {
    if (!pendingDisconnect) return;
    try {
      await api.post(
        `/workspaces/${activeWorkspace.id}/integrations/${pendingDisconnect.provider}/disconnect`
      );
      toast.success(`${pendingDisconnect.providerName} disconnected`);
      loadConnections();
    } catch (err) {
      toast.error(err.message || 'Action failed');
    } finally {
      setPendingDisconnect(null);
    }
  };

  const handleSyncNow = async (provider) => {
    setSyncingProvider(provider);
    try {
      const res = await api.post(`/workspaces/${activeWorkspace.id}/integrations/${provider}/sync`);
      toast.success(
        `Sync Complete! ${res.data.items_synced} items updated, ${res.data.orders_imported} orders imported.`
      );
      loadConnections();
    } catch (err) {
      toast.error(err.message || 'Sync failed');
    } finally {
      setSyncingProvider(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="App Marketplace & Integrations Hub"
        description="Connect your eCommerce stores, global marketplaces, and shipping carriers for automated inventory sync"
      />

      {isLoading ? (
        <LoadingState message="Loading integrations..." />
      ) : error ? (
        <ErrorState description={error} onRetry={loadConnections} />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {INTEGRATION_PROVIDERS.map((prov) => {
            const Icon = prov.icon;
            const conn = connections.find((c) => c.provider === prov.id);
            const isActive = conn?.status === 'active';

            return (
              <Card key={prov.id} className={isActive ? 'border-primary/40' : undefined}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-6 w-6" />
                    </div>
                    <StatusBadge status={isActive ? 'connected' : 'inactive'}>
                      {isActive ? 'Connected' : 'Not Connected'}
                    </StatusBadge>
                  </div>
                  <CardTitle className="mt-4">{prov.name}</CardTitle>
                  <CardDescription className="text-[11px] font-bold uppercase tracking-wider">
                    {prov.category}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    {prov.description}
                  </p>
                  {isActive && conn?.last_synced_at && (
                    <p className="mt-4 text-xs text-muted-foreground">
                      Last Synced:{' '}
                      <strong>{new Date(conn.last_synced_at).toLocaleTimeString()}</strong>
                    </p>
                  )}
                </CardContent>
                <CardFooter className="flex gap-2">
                  <Button
                    onClick={() => handleToggleConnect(prov.id, prov.name)}
                    variant={isActive ? 'secondary' : 'default'}
                    className="flex-1"
                  >
                    <Power /> {isActive ? 'Disconnect' : 'Connect Store'}
                  </Button>
                  {isActive && (
                    <Button
                      onClick={() => handleSyncNow(prov.id)}
                      disabled={syncingProvider === prov.id}
                      variant="secondary"
                      size="icon"
                      title="Trigger Sync Now"
                    >
                      <RefreshCw
                        className={syncingProvider === prov.id ? 'animate-spin' : undefined}
                      />
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDisconnect}
        onOpenChange={(open) => {
          if (!open) setPendingDisconnect(null);
        }}
        title={`Disconnect ${pendingDisconnect?.providerName}?`}
        description="This will stop automatic inventory sync for this provider. You can reconnect at any time."
        confirmLabel="Disconnect"
        onConfirm={handleConfirmDisconnect}
      />
    </div>
  );
}
