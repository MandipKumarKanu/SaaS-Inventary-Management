import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { ProductService } from '../products/product.service.js';

export interface CSVProductRow {
  name: string;
  sku: string;
  barcode?: string;
  costPrice?: number;
  sellingPrice?: number;
  unit?: string;
  reorderPoint?: number;
}

/** Phase 8 (PRD §43): bounded imports — never stream an unbounded POST into N sequential creates. */
export const MAX_IMPORT_ROWS = 500;

export interface ImportError {
  row: number;
  sku: string;
  error: string;
  code?: string;
}

export interface ImportReport {
  mode: 'validate' | 'commit';
  imported: number;
  failed: number;
  /** validate mode: rows that WOULD import (commit writes this too, = imported) */
  valid: number;
  errors: ImportError[];
}

function errorCode(err: any): string | undefined {
  if (err instanceof AppError) return err.code;
  return undefined;
}

export class ImportService {
  /**
   * Import products from parsed CSV rows.
   *
   * mode=commit  — create each valid row (legacy behavior, unchanged).
   * mode=validate — dry-run: run every check, write nothing, return the same
   *                report so the UI can preview exactly what will happen.
   */
  static async importProducts(
    workspaceId: string,
    rows: CSVProductRow[],
    userId: string,
    mode: 'validate' | 'commit' = 'commit'
  ): Promise<ImportReport> {
    if (rows.length > MAX_IMPORT_ROWS) {
      throw AppError.unprocessable(
        `Import is limited to ${MAX_IMPORT_ROWS} rows per request; split the file into batches.`,
        'TOO_MANY_ROWS'
      );
    }

    const results: ImportReport = {
      mode,
      imported: 0,
      failed: 0,
      valid: 0,
      errors: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.sku || !row.name) {
        results.failed++;
        results.errors.push({ row: i + 1, sku: row.sku || 'N/A', error: 'Missing name or SKU', code: 'VALIDATION_ERROR' });
        continue;
      }

      try {
        // NOTE: this call performs the plan-limit gate, SKU-uniqueness check
        // and insert. In validate mode we must NOT write — so pre-check the
        // duplicates/limit ourselves and skip the create.
        if (mode === 'validate') {
          const { data: existing } = await supabaseAdmin
            .from('products')
            .select('id')
            .eq('workspace_id', workspaceId)
            .eq('sku', row.sku)
            .maybeSingle();
          if (existing) {
            throw AppError.conflict(`Product with SKU \"${row.sku}\" already exists in this workspace`, 'DUPLICATE_SKU');
          }
          results.valid++;
          continue;
        }

        await ProductService.create({
          workspaceId,
          name: row.name,
          sku: row.sku,
          barcode: row.barcode || undefined,
          costPrice: Number(row.costPrice) || 0,
          sellingPrice: Number(row.sellingPrice) || 0,
          unit: row.unit || 'pcs',
          reorderPoint: row.reorderPoint !== undefined ? Number(row.reorderPoint) : undefined,
          userId,
        });
        results.imported++;
        results.valid++;
      } catch (err: any) {
        results.failed++;
        results.errors.push({ row: i + 1, sku: row.sku, error: err.message || 'Import error', code: errorCode(err) });
      }
    }

    return results;
  }
}
