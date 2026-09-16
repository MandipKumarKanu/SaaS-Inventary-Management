import { useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { UploadCloud, FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Field } from '@/components/common/FormField';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

export function CSVImportPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [csvText, setCsvText] = useState(`name,sku,barcode,costPrice,sellingPrice,unit,reorderPoint
Wireless Mouse,SKU-MOUSE-01,192837465,15,29.99,pcs,10
Mechanical Keyboard,SKU-KEY-02,987654321,45,89.99,pcs,5`);

  const [importResult, setImportResult] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleImport = async () => {
    if (!csvText.trim() || !activeWorkspace) return;
    setIsSubmitting(true);
    setError('');
    setImportResult(null);

    try {
      const lines = csvText.trim().split('\n');
      if (lines.length < 2) {
        setError('CSV text must contain a header row and at least one data row.');
        setIsSubmitting(false);
        return;
      }

      const headers = lines[0].split(',').map((h) => h.trim());
      const rows = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map((v) => v.trim());
        if (values.length < 2) continue;

        const rowObj = {};
        headers.forEach((h, idx) => {
          rowObj[h] = values[idx] || '';
        });
        rows.push(rowObj);
      }

      const res = await api.post(`/workspaces/${activeWorkspace.id}/import/products`, { rows });
      setImportResult(res.data);
    } catch (err) {
      setError(err.message || 'Failed to process CSV import');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bulk CSV Catalog Import"
        description="Batch upload master product catalog, barcodes, pricing, and reorder points via CSV"
      />

      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>Paste or Upload CSV Data</CardTitle>
            <CardDescription>
              Columns: name, sku, barcode, costPrice, sellingPrice, unit, reorderPoint
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="CSV content" htmlFor="csv-text">
            <Textarea
              id="csv-text"
              rows={8}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="name,sku,barcode,costPrice,sellingPrice,unit,reorderPoint..."
              className="font-mono text-[13px] leading-relaxed"
            />
          </Field>
          <div className="flex justify-end">
            <Button onClick={handleImport} disabled={isSubmitting}>
              <UploadCloud /> {isSubmitting ? 'Importing Products...' : 'Start CSV Import'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Import failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {importResult && (
        <Card>
          <CardHeader>
            <CardTitle>Import Execution Summary</CardTitle>
            <CardDescription>Result of the bulk catalog import run</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-success/40 bg-success/10 p-4">
                <div className="text-xs text-muted-foreground">Successfully Imported</div>
                <div className="mt-1 text-2xl font-extrabold text-success">
                  {importResult.imported} products
                </div>
              </div>
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
                <div className="text-xs text-muted-foreground">Failed Rows</div>
                <div className="mt-1 text-2xl font-extrabold text-destructive">
                  {importResult.failed} rows
                </div>
              </div>
            </div>

            {importResult.errors?.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>Validation Error Details</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-5">
                    {importResult.errors.map((err, idx) => (
                      <li key={idx}>
                        Row {err.row} (SKU:{' '}
                        <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">
                          {err.sku}
                        </span>
                        ): {err.error}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
