import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { ArrowLeft, PackageCheck } from 'lucide-react';
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

import { useCurrency } from '../../lib/currency';

export function PODetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const { format } = useCurrency();
  const [po, setPo] = useState(null);
  const [receivingQtys, setReceivingQtys] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadPO = async () => {
    if (!activeWorkspace || !id) return;
    setIsLoading(true);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/purchases/${id}`);
      setPo(res.data);
      const initMap = {};
      (res.data?.items || []).forEach((it) => {
        const remaining = Math.max(0, it.ordered_qty - (it.received_qty || 0));
        initMap[it.id] = remaining;
      });
      setReceivingQtys(initMap);
    } catch (err) {
      setError(err.message || 'Failed to load PO details');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPO();
  }, [activeWorkspace, id]);

  const handleQtyChange = (itemId, val) => {
    setReceivingQtys({
      ...receivingQtys,
      [itemId]: val === '' ? '' : Math.max(0, parseInt(val) || 0),
    });
  };

  const handleReceiveStock = async () => {
    setIsSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      const payload = Object.entries(receivingQtys)
        .filter(([_, qty]) => Number(qty) > 0)
        .map(([itemId, qtyToReceive]) => ({ itemId, qtyToReceive: Number(qtyToReceive) }));

      if (payload.length === 0) {
        const message = 'Please enter at least one item quantity to receive.';
        setError(message);
        toast.error(message);
        setIsSubmitting(false);
        return;
      }

      await api.post(`/workspaces/${activeWorkspace.id}/purchases/${id}/receive`, { items: payload });
      const message = 'Goods received successfully! Stock added to target warehouse.';
      setSuccessMsg(message);
      toast.success(message);
      await loadPO();
    } catch (err) {
      const message = err.message || 'Failed to receive goods';
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <LoadingState message="Loading PO details..." />;

  if (error || !po) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => navigate(-1)}>
          <ArrowLeft /> Back to PO List
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error || 'Purchase Order not found'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const isFullyReceived = po.status === 'received' || po.status === 'closed';

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/purchases">Purchase Orders</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{po.po_number}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={`Purchase Order ${po.po_number}`}
        description={`Supplier: ${po.supplier?.name ?? ''} · Destination: ${po.warehouse?.name ?? ''} (${po.warehouse?.code ?? ''})`}
        actions={
          <>
            <StatusBadge status={po.status} />
            {!isFullyReceived && (
              <ConfirmDialog
                title="Receive goods?"
                description="The entered quantities will be added to the destination warehouse stock."
                confirmLabel="Receive Items"
                onConfirm={handleReceiveStock}
                trigger={
                  <Button disabled={isSubmitting}>
                    <PackageCheck /> Receive Selected Items
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
            <p className="text-xs text-muted-foreground">Supplier</p>
            <p className="mt-1 text-sm font-semibold">{po.supplier?.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Destination Warehouse</p>
            <p className="mt-1 text-sm font-semibold">
              {po.warehouse?.name} ({po.warehouse?.code})
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Value</p>
            <p className="mt-1 text-sm font-extrabold text-success">{format(po.total_amount)}</p>
          </div>
        </CardContent>
      </Card>

      <DataTable
        head={
          <>
            <TableHead>Product / SKU</TableHead>
            <TableHead>Unit Cost</TableHead>
            <TableHead>Ordered Qty</TableHead>
            <TableHead>Received So Far</TableHead>
            <TableHead>Qty to Receive Now</TableHead>
          </>
        }
        isLoading={false}
        isEmpty={(po.items?.length ?? 0) === 0}
        emptyTitle="No line items"
        emptyDescription="This purchase order has no line items."
        colSpan={5}
        columns={5}
      >
        {po.items?.map((item) => {
          const remaining = Math.max(0, item.ordered_qty - (item.received_qty || 0));

          return (
            <TableRow key={item.id}>
              <TableCell className="font-semibold">
                {item.product?.name}{' '}
                <span className="text-xs font-normal text-muted-foreground">({item.product?.sku})</span>
              </TableCell>
              <TableCell className="font-semibold">{format(item.unit_cost)}</TableCell>
              <TableCell className="font-bold">{item.ordered_qty}</TableCell>
              <TableCell
                className={
                  item.received_qty >= item.ordered_qty
                    ? 'font-bold text-success'
                    : 'font-bold text-warning'
                }
              >
                {item.received_qty || 0} / {item.ordered_qty}
              </TableCell>
              <TableCell>
                {remaining === 0 ? (
                  <StatusBadge status="received">Fully Received</StatusBadge>
                ) : (
                  <Input
                    type="number"
                    min="0"
                    max={remaining}
                    value={receivingQtys[item.id] ?? ''}
                    onChange={(e) => handleQtyChange(item.id, e.target.value)}
                    className="w-24 font-bold"
                  />
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>

      <Card>
        <CardContent className="flex items-center justify-between p-6">
          <span className="text-sm text-muted-foreground">Order Total</span>
          <span className="text-xl font-extrabold text-success">{format(po.total_amount)}</span>
        </CardContent>
      </Card>
    </div>
  );
}
