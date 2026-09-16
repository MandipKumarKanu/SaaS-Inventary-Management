import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { AuditService } from '../audit/audit.service.js';
import { UsageService } from '../../services/usage.service.js';

export interface CreateVariantInput {
  sku: string;
  name: string;
  attributes?: Record<string, any>;
  costPrice?: number;
  sellingPrice?: number;
}

export interface CreateProductDTO {
  workspaceId: string;
  name: string;
  sku: string;
  barcode?: string;
  categoryId?: string;
  brandId?: string;
  description?: string;
  unit?: string;
  costPrice?: number;
  sellingPrice?: number;
  reorderPoint?: number;
  minStock?: number;
  maxStock?: number;
  variants?: CreateVariantInput[];
  userId: string;
}

export class ProductService {
  static async list(workspaceId: string, queryParams: { page?: number; pageSize?: number; search?: string; categoryId?: string; brandId?: string; includeArchived?: boolean }) {
    const page = queryParams.page || 1;
    const pageSize = Math.min(queryParams.pageSize || 25, 100);

    let query = supabaseAdmin
      .from('products')
      .select('*, category:categories(id, name), brand:brands(id, name), variants:product_variants(*)', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    // Phase 5: archived products are hidden by default (PRD §55)
    if (!queryParams.includeArchived) {
      query = query.is('archived_at', null);
    }

    if (queryParams.search) {
      query = query.or(`name.ilike.%${queryParams.search}%,sku.ilike.%${queryParams.search}%,barcode.ilike.%${queryParams.search}%`);
    }

    if (queryParams.categoryId) {
      query = query.eq('category_id', queryParams.categoryId);
    }

    if (queryParams.brandId) {
      query = query.eq('brand_id', queryParams.brandId);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return {
      data: data || [],
      meta: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    };
  }

  static async getById(id: string, workspaceId: string) {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('*, category:categories(id, name), brand:brands(id, name), variants:product_variants(*)')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) throw AppError.notFound('Product not found');
    return data;
  }

  static async create(dto: CreateProductDTO) {
    // 0. Plan limit gate (PRD §15: enforced server-side even via direct API)
    await UsageService.assertWithinLimit(dto.workspaceId, 'products');

    // 1. Check SKU uniqueness
    const { data: existing } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('workspace_id', dto.workspaceId)
      .eq('sku', dto.sku)
      .maybeSingle();

    if (existing) {
      throw AppError.conflict(`Product with SKU "${dto.sku}" already exists in this workspace`);
    }

    // 2. Insert main product
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .insert({
        workspace_id: dto.workspaceId,
        name: dto.name,
        sku: dto.sku,
        barcode: dto.barcode || null,
        category_id: dto.categoryId || null,
        brand_id: dto.brandId || null,
        description: dto.description || null,
        unit: dto.unit || 'pcs',
        cost_price: dto.costPrice || 0,
        selling_price: dto.sellingPrice || 0,
        reorder_point: dto.reorderPoint !== undefined ? dto.reorderPoint : 10,
        min_stock: dto.minStock !== undefined ? dto.minStock : 0,
        max_stock: dto.maxStock || null,
      })
      .select()
      .single();

    if (error) throw error;

    // 3. Create variants if provided
    if (dto.variants && dto.variants.length > 0) {
      const variantInserts = dto.variants.map((v) => ({
        product_id: product.id,
        sku: v.sku,
        name: v.name,
        attributes: v.attributes || {},
        cost_price: v.costPrice || dto.costPrice || 0,
        selling_price: v.sellingPrice || dto.sellingPrice || 0,
      }));

      const { error: vError } = await supabaseAdmin
        .from('product_variants')
        .insert(variantInserts);

      if (vError) throw vError;
    }

    await AuditService.log({
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      action: 'product.created',
      entity: 'product',
      entityId: product.id,
      newValue: { name: dto.name, sku: dto.sku },
    });

    await UsageService.refreshUsage(dto.workspaceId, 'products');

    return this.getById(product.id, dto.workspaceId);
  }

  static async update(id: string, workspaceId: string, updates: Partial<CreateProductDTO>, userId: string) {
    const existingProduct = await this.getById(id, workspaceId);

    const { data: updated, error } = await supabaseAdmin
      .from('products')
      .update({
        name: updates.name ?? existingProduct.name,
        category_id: updates.categoryId !== undefined ? updates.categoryId : existingProduct.category_id,
        brand_id: updates.brandId !== undefined ? updates.brandId : existingProduct.brand_id,
        description: updates.description !== undefined ? updates.description : existingProduct.description,
        cost_price: updates.costPrice ?? existingProduct.cost_price,
        selling_price: updates.sellingPrice ?? existingProduct.selling_price,
        reorder_point: updates.reorderPoint ?? existingProduct.reorder_point,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single();

    if (error) throw error;

    await AuditService.log({
      workspaceId,
      userId,
      action: 'product.updated',
      entity: 'product',
      entityId: id,
      previousValue: { name: existingProduct.name },
      newValue: { name: updated.name },
    });

    return this.getById(id, workspaceId);
  }

  /**
   * Phase 5: soft delete. Business records with stock/ledger history are never
   * hard-deleted (PRD §55, Rule #11) — DB-level RESTRICT (migration 014) is
   * the backstop, this is the actual path.
   */
  static async archive(id: string, workspaceId: string, userId: string) {
    const product = await this.getById(id, workspaceId);

    if (product.archived_at) {
      throw AppError.badRequest('Product is already archived');
    }

    const { error } = await supabaseAdmin
      .from('products')
      .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) throw error;

    await AuditService.log({
      workspaceId,
      userId,
      action: 'product.archived',
      entity: 'product',
      entityId: id,
      previousValue: { sku: product.sku, name: product.name, archived_at: null },
      newValue: { archived_at: new Date().toISOString() },
    });

    await UsageService.refreshUsage(workspaceId, 'products');
    return this.getById(id, workspaceId);
  }

  static async restore(id: string, workspaceId: string, userId: string) {
    const product = await this.getById(id, workspaceId);

    if (!product.archived_at) {
      throw AppError.badRequest('Product is not archived');
    }

    const { error } = await supabaseAdmin
      .from('products')
      .update({ archived_at: null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) throw error;

    await AuditService.log({
      workspaceId,
      userId,
      action: 'product.restored',
      entity: 'product',
      entityId: id,
      previousValue: { archived_at: product.archived_at },
      newValue: { archived_at: null },
    });

    await UsageService.refreshUsage(workspaceId, 'products');
    return this.getById(id, workspaceId);
  }

  static async lookupByCode(workspaceId: string, code: string) {
    if (!code) throw AppError.badRequest('Lookup code required');
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .select('*, category:categories(id, name), brand:brands(id, name), variants:product_variants(*)')
      .eq('workspace_id', workspaceId)
      .or(`sku.eq.${code},barcode.eq.${code}`)
      .maybeSingle();

    if (error) throw error;
    if (!product) throw AppError.notFound(`No product found with barcode or SKU "${code}"`);

    const { data: stock } = await supabaseAdmin
      .from('inventory')
      .select('*, warehouse:warehouses(id, name, code)')
      .eq('workspace_id', workspaceId)
      .eq('product_id', product.id);

    return {
      product,
      stock: stock || [],
      totalStock: (stock || []).reduce((acc: number, item: any) => acc + (item.quantity || 0), 0),
    };
  }
}

