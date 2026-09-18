import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { ArrowLeft, Truck } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, LoadingState } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from '@/components/ui/sonner';

import { useCurrency } from '../../lib/currency';

export function SODetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const { format } = useCurrency();
  const [so, setSo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadSO = async () => {
    if (!activeWorkspace || !id) return;
    setIsLoading(true);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/sales/${id}`);
      setSo(res.data);
    } catch (err) {
      setError(err.message || 'Failed to load SO details');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSO();
  }, [activeWorkspace, id]);

  const handleFulfillOrder = async () => {
    setIsSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/sales/${id}/fulfill`);
      const message = 'Sales order fulfilled & shipped! Stock deducted.';
      setSuccessMsg(message);
      toast.success(message);
      await loadSO();
    } catch (err) {
      const message = err.message || 'Failed to fulfill order';
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <LoadingState message="Loading SO details..." />;

  if (error || !so) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => navigate(-1)}>
          <ArrowLeft /> Back to SO List
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error || 'Sales Order not found'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const isShippedOrDelivered = so.status === 'shipped' || so.status === 'delivered';

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/sales">Sales Orders</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{so.so_number}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={`Sales Order ${so.so_number}`}
        description={`Customer: ${so.customer?.name || 'Walk-in Customer'} · Fulfillment Facility: ${so.warehouse?.name ?? ''} (${so.warehouse?.code ?? ''})`}
        actions={
          <>
            <StatusBadge status={so.status} />
            {!isShippedOrDelivered && (
              <ConfirmDialog
                title="Fulfill & ship this order?"
                description="Fulfilling this order will deduct stock from the warehouse and create ledger audit records."
                confirmLabel="Fulfill & Ship"
                onConfirm={handleFulfillOrder}
                trigger={
                  <Button disabled={isSubmitting}>
                    <Truck /> Fulfill & Ship Stock
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
          <CardTitle>Order Information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Customer</p>
            <p className="mt-1 text-sm font-semibold">{so.customer?.name || 'Walk-in Customer'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fulfillment Warehouse</p>
            <p className="mt-1 text-sm font-semibold">
              {so.warehouse?.name} ({so.warehouse?.code})
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Value</p>
            <p className="mt-1 text-sm font-extrabold text-success">{format(so.total_amount)}</p>
          </div>
        </CardContent>
      </Card>

      <DataTable
        head={
          <>
            <TableHead>Product / SKU</TableHead>
            <TableHead>Unit Price</TableHead>
            <TableHead>Ordered Qty</TableHead>
            <TableHead>Fulfilled Qty</TableHead>
            <TableHead className="text-right">Total Price</TableHead>
          </>
        }
        isLoading={false}
        isEmpty={(so.items?.length ?? 0) === 0}
        emptyTitle="No line items"
        emptyDescription="This sales order has no line items."
        colSpan={5}
        columns={5}
      >
        {so.items?.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-semibold">
              {item.product?.name}{' '}
              <span className="text-xs font-normal text-muted-foreground">({item.product?.sku})</span>
            </TableCell>
            <TableCell className="font-semibold">{format(item.unit_price)}</TableCell>
            <TableCell className="font-bold">{item.ordered_qty}</TableCell>
            <TableCell
              className={
                item.fulfilled_qty >= item.ordered_qty
                  ? 'font-bold text-success'
                  : 'font-bold text-warning'
              }
            >
              {item.fulfilled_qty || 0} / {item.ordered_qty}
            </TableCell>
            <TableCell className="text-right font-extrabold text-success">
              {format(item.ordered_qty * item.unit_price)}
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      <Card>
        <CardContent className="flex items-center justify-between p-6">
          <span className="text-sm text-muted-foreground">Order Total</span>
          <span className="text-xl font-extrabold text-success">{format(so.total_amount)}</span>
        </CardContent>
      </Card>
    </div>
  );
}
