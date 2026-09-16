import { useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Sparkles, Database } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from '@/components/ui/sonner';

export function DemoDataSettingsPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState(null);

  const handleSeedData = async () => {
    if (!activeWorkspace) return;
    setIsSeeding(true);
    try {
      const res = await api.post(`/workspaces/${activeWorkspace.id}/seed-demo-data`);
      setSeedResult(res.data.seeded_summary || res.data);
      toast.success('Demo Dataset Seeded Successfully! Check your Products & Inventory tabs.');
    } catch (err) {
      toast.error(err.message || 'Failed to seed demo data');
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="1-Click Demo Data Seeder"
        description="Instantly populate your workspace with realistic products, warehouses, suppliers, customers, and stock transactions for evaluation"
      />

      <Card>
        <CardContent className="flex flex-col items-center gap-4 pt-8 pb-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Sparkles className="h-8 w-8" />
          </div>

          <h2 className="text-xl font-extrabold tracking-tight">
            Evaluate StockFlow PRO with Real Sample Data
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            Clicking seed will automatically generate 5 master products (MacBook Pro, Dell XPS, Sony Headphones, etc.), 2 warehouse locations, suppliers, customers, and stock balance adjustments.
          </p>

          <ConfirmDialog
            title="Seed demo data?"
            description="Would you like to seed realistic demo products, warehouses, suppliers, and stock balances into this workspace?"
            confirmLabel="Seed Sample Demo Data"
            destructive={false}
            onConfirm={handleSeedData}
            trigger={
              <Button disabled={isSeeding} size="lg">
                <Database className={isSeeding ? 'h-[18px] w-[18px] animate-spin' : 'h-[18px] w-[18px]'} />
                {isSeeding ? 'Seeding Dataset...' : 'Seed Sample Demo Data'}
              </Button>
            }
          />

          {seedResult && (
            <Alert variant="success" className="mt-5 max-w-xl">
              <AlertDescription>
                Dataset Seeded! Created {seedResult.products_created} Products, {seedResult.warehouses_created} Warehouses, {seedResult.suppliers_created} Suppliers, and {seedResult.customers_created} Customers.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
