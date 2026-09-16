import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { AuditService } from '../audit/audit.service.js';

export interface CreateCustomerDTO {
  workspaceId: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  taxId?: string;
  userId: string;
}

export class CustomerService {
  static async list(workspaceId: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);
    let query = supabaseAdmin
      .from('customers')
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
      .from('customers')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) throw AppError.notFound('Customer not found');
    return data;
  }

  static async create(dto: CreateCustomerDTO) {
    const { data: existing } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('workspace_id', dto.workspaceId)
      .eq('name', dto.name)
      .maybeSingle();

    if (existing) {
      throw AppError.conflict(`Customer "${dto.name}" already exists`);
    }

    const { data, error } = await supabaseAdmin
      .from('customers')
      .insert({
        workspace_id: dto.workspaceId,
        name: dto.name,
        email: dto.email || null,
        phone: dto.phone || null,
        address: dto.address || null,
        tax_id: dto.taxId || null,
      })
      .select()
      .single();

    if (error) throw error;

    await AuditService.log({
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      action: 'customer.created',
      entity: 'customer',
      entityId: data.id,
      newValue: { name: dto.name },
    });

    return data;
  }
}
