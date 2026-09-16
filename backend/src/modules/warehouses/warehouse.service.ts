import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { AuditService } from '../audit/audit.service.js';
import { UsageService } from '../../services/usage.service.js';

export interface CreateWarehouseDTO {
  workspaceId: string;
  name: string;
  code: string;
  address?: string;
  contactNumber?: string;
  userId: string;
}

export class WarehouseService {
  static async list(workspaceId: string, queryParams?: { page?: number; pageSize?: number; includeArchived?: boolean }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);
    let query = supabaseAdmin
      .from('warehouses')
      .select('*, locations:warehouse_locations(*)', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('name', { ascending: true });

    // Phase 5: archived warehouses are hidden by default (PRD §55)
    if (!queryParams?.includeArchived) {
      query = query.is('archived_at', null);
    }

    if (page) query = query.range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;

    if (error) throw error;
    const total = count || 0;
    return { data: data || [], meta: { page: page || 1, pageSize: page ? pageSize : total, total, totalPages: page ? Math.ceil(total / pageSize) : 1 } };
  }

  static async getById(id: string, workspaceId: string) {
    const { data, error } = await supabaseAdmin
      .from('warehouses')
      .select('*, locations:warehouse_locations(*)')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) throw AppError.notFound('Warehouse not found');
    return data;
  }

  static async create(dto: CreateWarehouseDTO) {
    // Plan limit gate (PRD §15: enforced server-side even via direct API)
    await UsageService.assertWithinLimit(dto.workspaceId, 'warehouses');

    const { data: existing } = await supabaseAdmin
      .from('warehouses')
      .select('id')
      .eq('workspace_id', dto.workspaceId)
      .eq('code', dto.code)
      .maybeSingle();

    if (existing) {
      throw AppError.conflict(`Warehouse code "${dto.code}" already exists in this workspace`);
    }

    const { data, error } = await supabaseAdmin
      .from('warehouses')
      .insert({
        workspace_id: dto.workspaceId,
        name: dto.name,
        code: dto.code,
        address: dto.address || null,
        contact_number: dto.contactNumber || null,
      })
      .select()
      .single();

    if (error) throw error;

    await AuditService.log({
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      action: 'warehouse.created',
      entity: 'warehouse',
      entityId: data.id,
      newValue: { name: dto.name, code: dto.code },
    });

    await UsageService.refreshUsage(dto.workspaceId, 'warehouses');

    return data;
  }

  static async addLocation(warehouseId: string, workspaceId: string, location: { code: string; zone?: string; rack?: string; shelf?: string; bin?: string }) {
    await this.getById(warehouseId, workspaceId);

    const { data, error } = await supabaseAdmin
      .from('warehouse_locations')
      .insert({
        warehouse_id: warehouseId,
        code: location.code,
        zone: location.zone || null,
        rack: location.rack || null,
        shelf: location.shelf || null,
        bin: location.bin || null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Phase 5: soft delete. Stock balances + ledger rows reference warehouses
   * with ON DELETE RESTRICT (migration 014); archival is the only path.
   */
  static async archive(id: string, workspaceId: string, userId: string) {
    const warehouse = await this.getById(id, workspaceId);

    if (warehouse.archived_at) {
      throw AppError.badRequest('Warehouse is already archived');
    }

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('warehouses')
      .update({ archived_at: now, status: 'archived', updated_at: now })
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) throw error;

    await AuditService.log({
      workspaceId,
      userId,
      action: 'warehouse.archived',
      entity: 'warehouse',
      entityId: id,
      previousValue: { name: warehouse.name, code: warehouse.code, archived_at: null },
      newValue: { archived_at: now },
    });

    await UsageService.refreshUsage(workspaceId, 'warehouses');
    return this.getById(id, workspaceId);
  }

  static async restore(id: string, workspaceId: string, userId: string) {
    const warehouse = await this.getById(id, workspaceId);

    if (!warehouse.archived_at) {
      throw AppError.badRequest('Warehouse is not archived');
    }

    const { error } = await supabaseAdmin
      .from('warehouses')
      .update({ archived_at: null, status: 'active', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) throw error;

    await AuditService.log({
      workspaceId,
      userId,
      action: 'warehouse.restored',
      entity: 'warehouse',
      entityId: id,
      previousValue: { archived_at: warehouse.archived_at },
      newValue: { archived_at: null },
    });

    await UsageService.refreshUsage(workspaceId, 'warehouses');
    return this.getById(id, workspaceId);
  }
}
