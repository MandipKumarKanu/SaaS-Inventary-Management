import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { AuditService } from '../audit/audit.service.js';
import { TxClient } from '../../db/pool.js';

export type SerialStatus = 'available' | 'reserved' | 'sold' | 'returned' | 'damaged' | 'in_transit';

/** Legal lifecycle transitions (PRD §34) */
const SERIAL_TRANSITIONS: Record<SerialStatus, SerialStatus[]> = {
  available: ['reserved', 'sold', 'in_transit', 'damaged'],
  reserved: ['sold', 'available', 'damaged'],
  sold: ['returned'],
  returned: ['available', 'damaged'],
  damaged: [],
  in_transit: ['available', 'damaged'],
};

export interface SerialRow {
  id: string;
  workspace_id: string;
  product_id: string;
  warehouse_id: string | null;
  serial_number: string;
  status: SerialStatus;
}

/**
 * Phase 6 (PRD §34): serial numbers are real inventory identity.
 *
 * All lifecycle changes run INSIDE the caller's stock transaction so a serial
 * can never claim a state the ledger disagrees with. Uniqueness is enforced by
 * the DB (workspace_id, product_id, serial_number) from migration 004 —
 * duplicate registration attempts surface as 409 DUPLICATE_SERIAL.
 */
export class SerialService {
  // ------------------------------------------------------------------
  // In-transaction lifecycle (called by PO/SO/transfer/return services)
  // ------------------------------------------------------------------

  /** Record newly received serials (PO receipt). All-or-nothing. */
  static async registerOnReceipt(
    client: TxClient,
    input: {
      workspaceId: string;
      productId: string;
      warehouseId: string;
      serials: string[];
      poId: string;
      userId: string;
    }
  ): Promise<void> {
    if (!input.serials.length) return;

    const values = input.serials.map((s, i) => `($1, $2, $3, $4, $${5}, 'available', $${6}, ${i + 1})`);
    try {
      await client.query(
        `INSERT INTO serial_numbers
           (workspace_id, product_id, warehouse_id, serial_number, status, last_movement_ref)
         VALUES ${values.join(', ')}`,
        [input.workspaceId, input.productId, input.warehouseId, ...input.serials, `po:${input.poId}`]
      );
    } catch (err: any) {
      if (err.code === '23505' || /duplicate key/i.test(err.message || '')) {
        throw AppError.conflict(
          'One or more serial numbers already exist for this product in this workspace',
          'DUPLICATE_SERIAL'
        );
      }
      throw err;
    }
  }

  /** Flip serials available → sold at fulfillment (inside the SO tx). */
  static async markShipped(
    client: TxClient,
    input: { workspaceId: string; productId: string; serials: string[]; soId: string; userId: string }
  ): Promise<void> {
    if (!input.serials.length) return;
    await this.transitionInTx(client, {
      workspaceId: input.workspaceId,
      productId: input.productId,
      serials: input.serials,
      to: 'sold',
      contextRef: `so:${input.soId}`,
      allowedFrom: ['available', 'reserved', 'returned'],
    });
  }

  /** Ship leg of a transfer: available → in_transit at the source. */
  static async markTransferredOut(
    client: TxClient,
    input: { workspaceId: string; productId: string; serials: string[]; transferId: string; userId: string }
  ): Promise<void> {
    if (!input.serials.length) return;
    await this.transitionInTx(client, {
      workspaceId: input.workspaceId,
      productId: input.productId,
      serials: input.serials,
      to: 'in_transit',
      contextRef: `transfer:${input.transferId}:out`,
      allowedFrom: ['available'],
    });
  }

  /** Receive leg of a transfer: in_transit → available at the destination. */
  static async markTransferredIn(
    client: TxClient,
    input: { workspaceId: string; productId: string; serials: string[]; transferId: string; destWarehouseId: string; userId: string }
  ): Promise<void> {
    if (!input.serials.length) return;
    await client.query(
      `UPDATE serial_numbers
         SET status = 'available', warehouse_id = $4, last_movement_ref = $5, updated_at = NOW()
       WHERE workspace_id = $1 AND product_id = $2 AND serial_number = ANY($3) AND status = 'in_transit'`,
      [input.workspaceId, input.productId, input.serials, input.destWarehouseId, `transfer:${input.transferId}:in`]
    );
  }

  /** Return restock: sold → available at the receiving warehouse. */
  static async markReturned(
    client: TxClient,
    input: { workspaceId: string; productId: string; serials: string[]; returnId: string; warehouseId: string; userId: string }
  ): Promise<void> {
    if (!input.serials.length) return;
    await client.query(
      `UPDATE serial_numbers
         SET status = 'available', warehouse_id = $4, last_movement_ref = $5, updated_at = NOW()
       WHERE workspace_id = $1 AND product_id = $2 AND serial_number = ANY($3) AND status = 'sold'`,
      [input.workspaceId, input.productId, input.serials, input.warehouseId, `return:${input.returnId}`]
    );
  }

  /** Core in-tx transition with strict allowed-from validation. */
  private static async transitionInTx(
    client: TxClient,
    input: {
      workspaceId: string;
      productId: string;
      serials: string[];
      to: SerialStatus;
      contextRef: string;
      allowedFrom: SerialStatus[];
    }
  ): Promise<void> {
    // SELECT params: $1 workspace, $2 product, $3.. serials
    const selPlaceholders = input.serials.map((_, i) => `$${i + 3}`).join(', ');
    const check = await client.query(
      `SELECT serial_number, status FROM serial_numbers
       WHERE workspace_id = $1 AND product_id = $2 AND serial_number IN (${selPlaceholders})`,
      [input.workspaceId, input.productId, ...input.serials]
    );

    const found = new Map<string, SerialStatus>(check.rows.map((r: any) => [r.serial_number, r.status]));
    for (const s of input.serials) {
      const current = found.get(s);
      if (!current) {
        throw AppError.notFound(`Serial ${s} not registered for this product`, 'UNKNOWN_SERIAL');
      }
      if (!input.allowedFrom.includes(current)) {
        throw new AppError(
          `Serial ${s} is ${current}; cannot move to ${input.to} from ${current}`,
          422,
          'INVALID_SERIAL_TRANSITION',
          true,
          { serial: s, from: current, to: input.to }
        );
      }
    }

    // UPDATE params: $1 workspace, $2 product, $3 status, $4 ref, $5.. serials
    const updPlaceholders = input.serials.map((_, i) => `$${i + 5}`).join(', ');
    await client.query(
      `UPDATE serial_numbers
         SET status = $3, last_movement_ref = $4, updated_at = NOW()
       WHERE workspace_id = $1 AND product_id = $2 AND serial_number IN (${updPlaceholders})`,
      [input.workspaceId, input.productId, input.to, input.contextRef, ...input.serials]
    );
  }

  // ------------------------------------------------------------------
  // Read paths (HTTP)
  // ------------------------------------------------------------------

  static async list(
    workspaceId: string,
    filters: { productId?: string; warehouseId?: string; status?: string; search?: string } = {},
    queryParams: { page?: number; pageSize?: number } = {}
  ) {
    const page = queryParams.page;
    const pageSize = Math.min(queryParams.pageSize || 25, 100);
    let query = supabaseAdmin
      .from('serial_numbers')
      .select('*, product:products(id, name, sku), warehouse:warehouses(id, name, code)', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (filters.productId) query = query.eq('product_id', filters.productId);
    if (filters.warehouseId) query = query.eq('warehouse_id', filters.warehouseId);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.search) query = query.or(`serial_number.ilike.%${filters.search}%`);

    if (page) query = query.range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    const total = count || 0;
    return { data: data || [], meta: { page: page || 1, pageSize: page ? pageSize : total, total, totalPages: page ? Math.ceil(total / pageSize) : 1 } };
  }

  static async getById(id: string, workspaceId: string) {
    const { data, error } = await supabaseAdmin
      .from('serial_numbers')
      .select('*, product:products(id, name, sku), warehouse:warehouses(id, name, code)')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw AppError.notFound('Serial number not found');
    return data;
  }
}
