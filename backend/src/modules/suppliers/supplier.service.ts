import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { AuditService } from '../audit/audit.service.js';

export interface CreateSupplierDTO {
  workspaceId: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  taxId?: string;
  paymentTerms?: string;
  leadTimeDays?: number;
  userId: string;
}

export class SupplierService {
  static async list(workspaceId: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);
    let query = supabaseAdmin
      .from('suppliers')
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
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) throw AppError.notFound('Supplier not found');
    return data;
  }

  static async create(dto: CreateSupplierDTO) {
    const { data: existing } = await supabaseAdmin
      .from('suppliers')
      .select('id')
      .eq('workspace_id', dto.workspaceId)
      .eq('name', dto.name)
      .maybeSingle();

    if (existing) {
      throw AppError.conflict(`Supplier "${dto.name}" already exists`);
    }

    const { data, error } = await supabaseAdmin
      .from('suppliers')
      .insert({
        workspace_id: dto.workspaceId,
        name: dto.name,
        contact_name: dto.contactName || null,
        email: dto.email || null,
        phone: dto.phone || null,
        address: dto.address || null,
        tax_id: dto.taxId || null,
        payment_terms: dto.paymentTerms || null,
        lead_time_days: dto.leadTimeDays || 7,
      })
      .select()
      .single();

    if (error) throw error;

    await AuditService.log({
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      action: 'supplier.created',
      entity: 'supplier',
      entityId: data.id,
      newValue: { name: dto.name },
    });

    return data;
  }
}
