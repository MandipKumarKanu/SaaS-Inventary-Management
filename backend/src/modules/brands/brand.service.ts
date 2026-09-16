import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { AuditService } from '../audit/audit.service.js';

export interface CreateBrandDTO {
  workspaceId: string;
  name: string;
  logoUrl?: string;
  userId: string;
}

export class BrandService {
  static async list(workspaceId: string) {
    const { data, error } = await supabaseAdmin
      .from('brands')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  static async create(dto: CreateBrandDTO) {
    const { data: existing } = await supabaseAdmin
      .from('brands')
      .select('id')
      .eq('workspace_id', dto.workspaceId)
      .eq('name', dto.name)
      .maybeSingle();

    if (existing) {
      throw AppError.conflict('Brand name already exists in this workspace');
    }

    const { data, error } = await supabaseAdmin
      .from('brands')
      .insert({
        workspace_id: dto.workspaceId,
        name: dto.name,
        logo_url: dto.logoUrl || null,
      })
      .select()
      .single();

    if (error) throw error;

    await AuditService.log({
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      action: 'brand.created',
      entity: 'brand',
      entityId: data.id,
      newValue: { name: dto.name },
    });

    return data;
  }

  static async delete(id: string, workspaceId: string, userId: string) {
    const { error } = await supabaseAdmin
      .from('brands')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) throw error;

    await AuditService.log({
      workspaceId,
      userId,
      action: 'brand.deleted',
      entity: 'brand',
      entityId: id,
    });
  }
}
