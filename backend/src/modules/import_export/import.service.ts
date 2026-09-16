import { supabaseAdmin } from '../../config/supabase.js';
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

export class ImportService {
  static async importProducts(workspaceId: string, rows: CSVProductRow[], userId: string) {
    const results = {
      imported: 0,
      failed: 0,
      errors: [] as { row: number; sku: string; error: string }[],
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.sku || !row.name) {
        results.failed++;
        results.errors.push({ row: i + 1, sku: row.sku || 'N/A', error: 'Missing name or SKU' });
        continue;
      }

      try {
        await ProductService.create({
          workspaceId,
          name: row.name,
          sku: row.sku,
          barcode: row.barcode || undefined,
          costPrice: Number(row.costPrice) || 0,
          sellingPrice: Number(row.sellingPrice) || 0,
          unit: row.unit || 'pcs',
          reorderPoint: Number(row.reorderPoint) || 10,
          userId,
        });
        results.imported++;
      } catch (err: any) {
        results.failed++;
        results.errors.push({ row: i + 1, sku: row.sku, error: err.message || 'Import error' });
      }
    }

    return results;
  }
}
