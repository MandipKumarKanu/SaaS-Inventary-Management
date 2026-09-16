import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Plus, Warehouse } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { PaginationBar } from '@/components/common/PaginationBar';
import { usePagination } from '@/hooks/usePagination';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { toast } from '@/components/ui/sonner';

export function WarehouseRoutingPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [rules, setRules] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [destinationRegion, setDestinationRegion] = useState('');
  const [preferredWarehouseId, setPreferredWarehouseId] = useState('');
  const [priority, setPriority] = useState('1');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const { page, setPage, pageSize, total, totalPages, applyMeta } = usePagination();

  const loadData = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const [rRes, wRes] = await Promise.all([
        api.get(`/workspaces/${activeWorkspace.id}/routing?page=${page}&pageSize=${pageSize}`),
        api.get(`/workspaces/${activeWorkspace.id}/warehouses`),
      ]);
      setRules(rRes.data || []);
      applyMeta(rRes.meta);
      setWarehouses(wRes.data || []);
      if (wRes.data && wRes.data.length > 0) {
        setPreferredWarehouseId(wRes.data[0].id);
      }
    } catch (err) {
      console.error('Failed to load routing rules:', err);
      setError(err.message || 'Failed to load routing rules');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeWorkspace, page]);

  const handleAddRule = async (e) => {
    e.preventDefault();
    if (!destinationRegion.trim() || !preferredWarehouseId) return;
    setIsSaving(true);
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/routing`, {
        destinationRegion,
        preferredWarehouseId,
        priority: parseInt(priority) || 1,
      });
      setDestinationRegion('');
      loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to add routing rule');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Smart 3PL Multi-Facility Warehouse Routing"
        description="Configure fulfillment rules to automatically route customer sales orders to the closest preferred 3PL warehouse location"
      />

      <Card>
        <CardHeader>
          <CardTitle>Add Regional Routing Rule</CardTitle>
          <CardDescription>Map a destination region to a preferred fulfillment warehouse.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddRule} className="grid items-center gap-3 lg:grid-cols-[1.5fr_1.5fr_1fr_auto]">
            <Input
              type="text"
              placeholder="Destination State / Zip (e.g. NY, CA, 90210)"
              value={destinationRegion}
              onChange={(e) => setDestinationRegion(e.target.value)}
              required
            />
            <Select value={preferredWarehouseId} onValueChange={setPreferredWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="Select warehouse" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              placeholder="Priority (1 = highest)"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              required
              min={1}
            />
            <Button type="submit" disabled={isSaving}>
              <Plus className="h-4 w-4" />
              {isSaving ? 'Saving...' : 'Add Rule'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b">
          <CardTitle>Active 3PL Regional Routing Matrix</CardTitle>
        </CardHeader>
        <DataTable
          head={
            <>
              <TableHead>Priority</TableHead>
              <TableHead>Destination Region / Zip</TableHead>
              <TableHead>Preferred Fulfillment Warehouse</TableHead>
            </>
          }
          isLoading={isLoading}
          isEmpty={!isLoading && rules.length === 0}
          error={error}
          onRetry={loadData}
          errorTitle="Couldn't load routing rules"
          colSpan={3}
          columns={3}
          emptyTitle="No 3PL regional routing rules configured."
        >
          {rules.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-extrabold text-primary">#{r.priority}</TableCell>
              <TableCell className="font-bold">{r.destination_region}</TableCell>
              <TableCell className="font-semibold text-success">
                <span className="flex items-center gap-2">
                  <Warehouse className="h-4 w-4" />
                  {r.warehouse?.name || 'Assigned Warehouse'}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      </Card>

      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
