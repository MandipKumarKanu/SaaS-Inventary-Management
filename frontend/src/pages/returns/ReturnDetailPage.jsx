import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, LoadingState } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from '@/components/ui/sonner';

export function ReturnDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const [ret, setRet] = useState(null);
  const [restockQtys, setRestockQtys] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadReturn = async () => {
    if (!activeWorkspace || !id) return;
    setIsLoading(true);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/returns/${id}`);
      setRet(res.data);
      const initMap = {};
      (res.data?.items || []).forEach((it) => {
        initMap[it.id] = it.returned_qty;
      });
      setRestockQtys(initMap);
    } catch (err) {
      setError(err.message || 'Failed to load Return details');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReturn();
  }, [activeWorkspace, id]);

  const handleQtyChange = (itemId, val) => {
    setRestockQtys({
      ...restockQtys,
      [itemId]: val === '' ? '' : Math.max(0, parseInt(val) || 0),
    });
  };

  const handleRestock = async () => {
    setIsSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      const payload = Object.entries(restockQtys).map(([itemId, restockQty]) => ({
        itemId,
        restockQty: Number(restockQty) || 0,
      }));

      await api.post(`/workspaces/${activeWorkspace.id}/returns/${id}/restock`, { items: payload });
      const message = 'Return inspected & restocked to inventory!';
      setSuccessMsg(message);
      toast.success(message);
      await loadReturn();
    } catch (err) {
      const message = err.message || 'Failed to restock return items';
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <LoadingState message="Loading RMA details..." />;

  if (error || !ret) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => navigate(-1)}>
          <ArrowLeft /> Back to Returns List
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error || 'Return record not found'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const isCompleted = ret.status === 'completed';
  const totalReturned = (ret.items || []).reduce((sum, it) => sum + (Number(it.returned_qty) || 0), 0);
  const totalRestocked = (ret.items || []).reduce((sum, it) => sum + (Number(it.restocked_qty) || 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/returns">Customer Returns</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{ret.return_number}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={`RMA ${ret.return_number}`}
        description={`Customer: ${ret.customer?.name || 'Standard Account'} · Facility: ${ret.warehouse?.name ?? ''} (${ret.warehouse?.code ?? ''})`}
        actions={
          <>
            <StatusBadge status={ret.status} />
            {!isCompleted && (
              <ConfirmDialog
                title="Restock return items?"
                description="The entered quantities will be inspected and added back to inventory."
                confirmLabel="Restock Items"
                onConfirm={handleRestock}
                trigger={
                  <Button disabled={isSubmitting}>
                    <RotateCcw /> Inspect & Restock
                  </Button>
                }
              />
            )}
          </>
        }
      />

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

      <Card>
        <CardHeader>
          <CardTitle>Return Information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Customer</p>
            <p className="mt-1 text-sm font-semibold">{ret.customer?.name || 'Standard Account'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Return Warehouse</p>
            <p className="mt-1 text-sm font-semibold">
              {ret.warehouse?.name} ({ret.warehouse?.code})
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <div className="mt-1">
              <StatusBadge status={ret.status} />
            </div>
          </div>
        </CardContent>
      </Card>

      <DataTable
        head={
          <>
            <TableHead>Product / SKU</TableHead>
            <TableHead>Condition</TableHead>
            <TableHead>Returned Qty</TableHead>
            <TableHead>Restocked Qty</TableHead>
          </>
        }
        isLoading={false}
        isEmpty={(ret.items?.length ?? 0) === 0}
        emptyTitle="No line items"
        emptyDescription="This return has no line items."
        colSpan={4}
        columns={4}
      >
        {ret.items?.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-semibold">
              {item.product?.name}{' '}
              <span className="text-xs font-normal text-muted-foreground">({item.product?.sku})</span>
            </TableCell>
            <TableCell>
              <StatusBadge status={item.condition} />
            </TableCell>
            <TableCell className="font-bold">{item.returned_qty}</TableCell>
            <TableCell>
              {isCompleted ? (
                <span className="font-bold text-success">{item.restocked_qty}</span>
              ) : (
                <Input
                  type="number"
                  min="0"
                  max={item.returned_qty}
                  value={restockQtys[item.id] ?? ''}
                  onChange={(e) => handleQtyChange(item.id, e.target.value)}
                  className="w-24 font-bold"
                />
              )}
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-6">
          <span className="text-sm text-muted-foreground">Total Returned</span>
          <span className="text-sm font-bold">
            {totalReturned} units
            <span className="ml-3 font-extrabold text-success">{totalRestocked} restocked</span>
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
