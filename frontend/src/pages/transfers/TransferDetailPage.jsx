import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { ArrowLeft, CheckCircle2, Truck, Package, Clock } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, LoadingState } from '@/components/common/DataTable';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { toast } from '@/components/ui/sonner';

export function TransferDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const [transfer, setTransfer] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState('');

  const loadTransfer = async () => {
    if (!activeWorkspace || !id) return;
    setIsLoading(true);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/transfers/${id}`);
      setTransfer(res.data);
    } catch (err) {
      setError(err.message || 'Failed to load transfer detail');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTransfer();
  }, [activeWorkspace, id]);

  const handleStatusUpdate = async (newStatus) => {
    setIsUpdating(true);
    setError('');
    try {
      await api.patch(`/workspaces/${activeWorkspace.id}/transfers/${id}/status`, {
        status: newStatus,
      });
      toast.success(`Transfer ${newStatus}`);
      await loadTransfer();
    } catch (err) {
      const message = err.message || `Failed to set status to ${newStatus}`;
      setError(message);
      toast.error(message);
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Button variant="ghost" onClick={() => navigate(-1)} className="w-fit">
          <ArrowLeft /> Back to Transfers List
        </Button>
        <LoadingState message="Loading transfer details..." />
      </div>
    );
  }

  if (error || !transfer) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" onClick={() => navigate(-1)} className="w-fit">
          <ArrowLeft /> Back to Transfers
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error || 'Transfer record not found.'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const steps = [
    { key: 'requested', label: 'Requested' },
    { key: 'approved', label: 'Approved' },
    { key: 'shipped', label: 'Shipped (Stock Out)' },
    { key: 'completed', label: 'Completed (Stock In)' },
  ];

  const currentIdx = steps.findIndex((s) => s.key === transfer.status);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/transfers">Stock Transfers</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{transfer.transfer_number}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={`Transfer ${transfer.transfer_number}`}
        description={`Source: ${transfer.source_warehouse?.name} → Destination: ${transfer.destination_warehouse?.name}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={transfer.status} />
            {transfer.status === 'requested' && (
              <ConfirmDialog
                title="Approve transfer?"
                description='Are you sure you want to change status to "APPROVED"?'
                confirmLabel="Approve"
                destructive={false}
                onConfirm={() => handleStatusUpdate('approved')}
                trigger={
                  <Button disabled={isUpdating}>
                    <CheckCircle2 /> Approve Transfer
                  </Button>
                }
              />
            )}
            {transfer.status === 'approved' && (
              <ConfirmDialog
                title="Ship stock?"
                description='Are you sure you want to change status to "SHIPPED"? Stock will be deducted from source.'
                confirmLabel="Ship Stock"
                destructive={false}
                onConfirm={() => handleStatusUpdate('shipped')}
                trigger={
                  <Button disabled={isUpdating}>
                    <Truck /> Ship Stock (Deduct Source)
                  </Button>
                }
              />
            )}
            {transfer.status === 'shipped' && (
              <ConfirmDialog
                title="Complete transfer?"
                description='Are you sure you want to change status to "COMPLETED"? Stock will be added to destination.'
                confirmLabel="Complete"
                destructive={false}
                onConfirm={() => handleStatusUpdate('completed')}
                trigger={
                  <Button disabled={isUpdating}>
                    <Package /> Complete & Receive Stock (Add Dest)
                  </Button>
                }
              />
            )}
            {transfer.status !== 'completed' && transfer.status !== 'cancelled' && (
              <ConfirmDialog
                title="Cancel transfer?"
                description='Are you sure you want to change status to "CANCELLED"?'
                confirmLabel="Cancel Transfer"
                onConfirm={() => handleStatusUpdate('cancelled')}
                trigger={
                  <Button variant="outline" disabled={isUpdating} className="text-destructive">
                    Cancel Transfer
                  </Button>
                }
              />
            )}
          </div>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Transfer Pipeline Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, idx) => {
              const isDone = currentIdx >= idx || transfer.status === 'completed';
              const isCurrent = transfer.status === step.key;
              return (
                <div
                  key={step.key}
                  className={`flex items-center gap-2.5 rounded-xl border p-4 ${
                    isCurrent
                      ? 'border-primary bg-primary/10'
                      : isDone
                        ? 'border-success/30 bg-success/5'
                        : 'border-border bg-muted/40'
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2
                      className={`h-5 w-5 ${isCurrent ? 'text-primary' : 'text-success'}`}
                    />
                  ) : (
                    <Clock className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div>
                    <div className="text-xs text-muted-foreground">Step {idx + 1}</div>
                    <div
                      className={`text-[13px] font-bold ${isDone ? 'text-foreground' : 'text-muted-foreground'}`}
                    >
                      {step.label}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transfer Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-sm text-muted-foreground">Source Warehouse</dt>
              <dd className="mt-0.5 text-sm font-semibold">{transfer.source_warehouse?.name}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Destination Warehouse</dt>
              <dd className="mt-0.5 text-sm font-semibold">{transfer.destination_warehouse?.name}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Status</dt>
              <dd className="mt-1">
                <StatusBadge status={transfer.status} />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Line Items</dt>
              <dd className="mt-0.5 text-sm font-semibold">{transfer.items?.length || 0}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <DataTable
        head={
          <>
            <TableHead>Product Name / SKU</TableHead>
            <TableHead>Requested Qty</TableHead>
            <TableHead>Shipped Qty</TableHead>
            <TableHead>Received Qty</TableHead>
          </>
        }
        isLoading={false}
        isEmpty={!transfer.items || transfer.items.length === 0}
        colSpan={4}
        columns={4}
        emptyTitle="No line items"
        emptyDescription="This transfer has no line items."
      >
        {transfer.items?.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-semibold">
              {item.product?.name}{' '}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                ({item.product?.sku})
              </span>
            </TableCell>
            <TableCell className="font-bold">{item.requested_qty}</TableCell>
            <TableCell className="font-bold text-warning">{item.shipped_qty || 0}</TableCell>
            <TableCell className="font-bold text-success">{item.received_qty || 0}</TableCell>
          </TableRow>
        ))}
      </DataTable>
    </div>
  );
}
