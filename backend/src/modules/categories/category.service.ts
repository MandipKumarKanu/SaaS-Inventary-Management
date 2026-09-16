import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { AuditService } from '../audit/audit.service.js';

export interface CreateCategoryDTO {
  workspaceId: string;
  name: string;
  slug: string;
  parentId?: string;
  description?: string;
  userId: string;
}

export class CategoryService {
  static async list(workspaceId: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);
    let query = supabaseAdmin
      .from('categories')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('name', { ascending: true });

    if (page) query = query.range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;

    if (error) throw error;
    const total = count || 0;
    return { data: data || [], meta: { page: page || 1, pageSize: page ? pageSize : total, total, totalPages: page ? Math.ceil(total / pageSize) : 1 } };
  }

  static async getById(id: string, workspaceId: string) {
    const { data, error } = await supabaseAdmin
      .from('categories')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) throw AppError.notFound('Category not found');
    return data;
  }

  static async create(dto: CreateCategoryDTO) {
    const { data: existing } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('workspace_id', dto.workspaceId)
      .eq('slug', dto.slug)
      .maybeSingle();

    if (existing) {
      throw AppError.conflict('Category slug already exists in this workspace');
    }

    const { data, error } = await supabaseAdmin
      .from('categories')
      .insert({
        workspace_id: dto.workspaceId,
        name: dto.name,
        slug: dto.slug,
        parent_id: dto.parentId || null,
        description: dto.description || null,
      })
      .select()
      .single();

    if (error) throw error;

    await AuditService.log({
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      action: 'category.created',
      entity: 'category',
      entityId: data.id,
      newValue: { name: dto.name, slug: dto.slug },
    });

    return data;
  }

  static async delete(id: string, workspaceId: string, userId: string) {
    const category = await this.getById(id, workspaceId);

    const { error } = await supabaseAdmin
      .from('categories')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) throw error;

    await AuditService.log({
      workspaceId,
      userId,
      action: 'category.deleted',
      entity: 'category',
      entityId: id,
      previousValue: { name: category.name },
    });
  }
}
