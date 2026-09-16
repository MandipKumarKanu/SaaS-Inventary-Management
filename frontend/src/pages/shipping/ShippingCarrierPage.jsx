import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Truck, Calculator, Barcode } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Field } from '@/components/common/FormField';
import { DataTable } from '@/components/common/DataTable';
import { PaginationBar } from '@/components/common/PaginationBar';
import { usePagination } from '@/hooks/usePagination';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { toast } from '@/components/ui/sonner';

export function ShippingCarrierPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [weightKg, setWeightKg] = useState('2.5');
  const [zip, setZip] = useState('90210');
  const [quotes, setQuotes] = useState([]);
  const [labels, setLabels] = useState([]);
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const { page, setPage, pageSize, total, totalPages, applyMeta } = usePagination();

  const loadLabels = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/shipping/labels?page=${page}&pageSize=${pageSize}`);
      setLabels(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load shipping labels:', err);
      setError(err.message || 'Failed to load shipping labels');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLabels();
  }, [activeWorkspace, page]);

  const handleFetchQuotes = async (e) => {
    e.preventDefault();
    setIsLoadingQuotes(true);
    try {
      const res = await api.post(`/workspaces/${activeWorkspace.id}/shipping/quotes`, {
        weightKg: parseFloat(weightKg),
        destinationZip: zip,
      });
      setQuotes(res.data || []);
    } catch (err) {
      toast.error(err.message || 'Failed to fetch rates');
    } finally {
      setIsLoadingQuotes(false);
    }
  };

  const handleCreateLabel = async (quote) => {
    setIsGenerating(true);
    try {
      const res = await api.post(`/workspaces/${activeWorkspace.id}/shipping/labels`, {
        carrier: quote.carrier,
        serviceLevel: quote.service_level,
        rateAmount: quote.rate_amount,
      });
      toast.success(`Shipping Label Created! Tracking Number: ${res.data.tracking_number}`);
      loadLabels();
    } catch (err) {
      toast.error(err.message || 'Failed to generate label');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Shipping Carriers & Rate Calculator"
        description="Compare estimated shipping rates across FedEx, UPS, DHL, and USPS, and generate internal tracking labels"
      />

      <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-[18px] w-[18px] text-primary" /> Estimate Shipping Rates
            </CardTitle>
            <CardDescription>Enter package weight and destination to calculate estimated rates</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleFetchQuotes}
            className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
          >
            <Field label="Package Weight (kg)" htmlFor="package-weight">
              <Input
                id="package-weight"
                type="number"
                step="0.1"
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
                required
              />
            </Field>
            <Field label="Destination Postal Code / ZIP" htmlFor="destination-zip">
              <Input
                id="destination-zip"
                type="text"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" disabled={isLoadingQuotes}>
              <Truck /> {isLoadingQuotes ? 'Calculating...' : 'Calculate Rates'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {quotes.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {quotes.map((q, idx) => (
            <Card key={idx}>
              <CardContent className="flex flex-col gap-1 p-6">
                <Badge variant="secondary" className="w-fit uppercase">
                  {q.carrier}
                </Badge>
                <span className="mt-2 text-base font-extrabold">{q.service_level}</span>
                <span className="text-2xl font-black text-success">
                  ${q.rate_amount.toFixed(2)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Est. Delivery: <strong>{q.estimated_days} Business Days</strong>
                  {q.is_estimate && ' · Estimated rate'}
                </span>
                <Button
                  onClick={() => handleCreateLabel(q)}
                  disabled={isGenerating}
                  className="mt-3 w-full"
                >
                  <Barcode /> Generate Label
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
            <CardTitle>Generated Shipping Labels</CardTitle>
            <CardDescription>Internal tracking labels created from estimated rate quotes</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            head={
              <>
                <TableHead>Carrier</TableHead>
                <TableHead>Tracking Number</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Created At</TableHead>
              </>
            }
            isLoading={isLoading}
            isEmpty={!isLoading && labels.length === 0}
            error={error}
            onRetry={loadLabels}
            errorTitle="Couldn't load shipping labels"
            colSpan={5}
            columns={5}
            emptyTitle="No shipping labels generated yet."
            emptyDescription="Calculate rates above and generate your first label."
          >
            {labels.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-bold uppercase">{l.carrier}</TableCell>
                <TableCell>
                  <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">
                    {l.tracking_number}
                  </span>
                </TableCell>
                <TableCell>{l.service_level}</TableCell>
                <TableCell className="font-bold text-success">
                  ${Number(l.rate_amount).toFixed(2)}
                </TableCell>
                <TableCell className="text-[13px] text-muted-foreground">
                  {new Date(l.created_at).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
          <div className="mt-4">
            <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
