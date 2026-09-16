import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { ArrowLeft, Save, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, LoadingState } from '@/components/common/DataTable';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { toast } from '@/components/ui/sonner';

export function CountDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const [count, setCount] = useState(null);
  const [physicalCounts, setPhysicalCounts] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadCount = async () => {
    if (!activeWorkspace || !id) return;
    setIsLoading(true);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/counts/${id}`);
      setCount(res.data);

      // Initialize physical count state mapping item.id -> physical_qty
      const initialMap = {};
      (res.data?.items || []).forEach((it) => {
        initialMap[it.id] = it.physical_qty ?? it.system_qty;
      });
      setPhysicalCounts(initialMap);
    } catch (err) {
      setError(err.message || 'Failed to load count sheet details');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCount();
  }, [activeWorkspace, id]);

  const handleQtyChange = (itemId, val) => {
    setPhysicalCounts({
      ...physicalCounts,
      [itemId]: val === '' ? '' : Math.max(0, parseInt(val) || 0),
    });
  };

  const handleSaveCounts = async () => {
    setIsSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      const payload = Object.entries(physicalCounts).map(([itemId, physicalQty]) => ({
        itemId,
        physicalQty: Number(physicalQty) || 0,
      }));
      await api.post(`/workspaces/${activeWorkspace.id}/counts/${id}/submit`, { items: payload });
      toast.success('Physical counts saved successfully!');
      setSuccessMsg('Physical counts saved successfully!');
      await loadCount();
    } catch (err) {
      const message = err.message || 'Failed to submit physical counts';
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproveCount = async () => {
    setIsSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/counts/${id}/approve`);
      toast.success('Cycle count approved! Stock levels reconciled.');
      setSuccessMsg('Cycle count approved! Stock levels reconciled.');
      await loadCount();
    } catch (err) {
      const message = err.message || 'Failed to approve cycle count';
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Button variant="ghost" onClick={() => navigate(-1)} className="w-fit">
          <ArrowLeft /> Back to Cycle Counts List
        </Button>
        <LoadingState message="Loading count sheet details..." />
      </div>
    );
  }

  if (error || !count) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" onClick={() => navigate(-1)} className="w-fit">
          <ArrowLeft /> Back to Cycle Counts
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error || 'Count sheet not found'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const isCompleted = count.status === 'completed';

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/counts">Cycle Counting</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{count.count_number}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={`Count Sheet ${count.count_number}`}
        description={`Facility: ${count.warehouse?.name} (${count.warehouse?.code})`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={count.status} />
            {!isCompleted && (
              <>
                <Button variant="secondary" onClick={handleSaveCounts} disabled={isSubmitting}>
                  <Save /> Save Entries
                </Button>
                <ConfirmDialog
                  title="Approve cycle count?"
                  description="Approving this cycle count will automatically reconcile variances via Inventory Core Engine adjustments. Proceed?"
                  confirmLabel="Approve & Reconcile"
                  destructive={false}
                  onConfirm={handleApproveCount}
                  trigger={
                    <Button disabled={isSubmitting}>
                      <CheckCircle2 /> Approve & Reconcile Variances
                    </Button>
                  }
                />
              </>
            )}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Count Sheet Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-sm text-muted-foreground">Count Number</dt>
              <dd className="mt-0.5 text-sm font-semibold">{count.count_number}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Warehouse</dt>
              <dd className="mt-0.5 text-sm font-semibold">
                {count.warehouse?.name} ({count.warehouse?.code})
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Status</dt>
              <dd className="mt-1">
                <StatusBadge status={count.status} />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Items</dt>
              <dd className="mt-0.5 text-sm font-semibold">
                <Badge variant="secondary">{count.items?.length || 0} audited</Badge>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {successMsg && (
        <Alert variant="success">
          <AlertDescription>{successMsg}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        head={
          <>
            <TableHead>Product / SKU</TableHead>
            <TableHead>System Qty (Snapshot)</TableHead>
            <TableHead>Physical Qty Counted</TableHead>
            <TableHead>Variance</TableHead>
            <TableHead>Reconciled Status</TableHead>
          </>
        }
        isLoading={false}
        isEmpty={!count.items || count.items.length === 0}
        colSpan={5}
        columns={5}
        emptyTitle="No audit items"
        emptyDescription="This count sheet has no items."
      >
        {count.items?.map((item) => {
          const currentPhysical = physicalCounts[item.id] ?? (item.physical_qty ?? item.system_qty);
          const variance = currentPhysical - item.system_qty;

          return (
            <TableRow key={item.id}>
              <TableCell className="font-semibold">
                {item.product?.name}{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  ({item.product?.sku})
                </span>
              </TableCell>
              <TableCell className="font-bold">{item.system_qty}</TableCell>
              <TableCell>
                {isCompleted ? (
                  <span className="font-bold">{item.physical_qty}</span>
                ) : (
                  <Input
                    type="number"
                    min="0"
                    value={physicalCounts[item.id] ?? ''}
                    onChange={(e) => handleQtyChange(item.id, e.target.value)}
                    className="w-[100px] font-bold"
                  />
                )}
              </TableCell>
              <TableCell>
                {variance === 0 ? (
                  <Badge variant="secondary">0 (Exact)</Badge>
                ) : variance > 0 ? (
                  <Badge variant="success">+{variance}</Badge>
                ) : (
                  <Badge variant="destructive">{variance}</Badge>
                )}
              </TableCell>
              <TableCell>
                {item.approved ? (
                  <StatusBadge status="completed">Approved & Adjusted</StatusBadge>
                ) : (
                  <StatusBadge status="pending">Pending</StatusBadge>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>
    </div>
  );
}
