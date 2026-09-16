import { supabaseAdmin } from '../../config/supabase.js';
import { InventoryService } from '../inventory/inventory.service.js';

export class ExternalApiService {
  /**
   * List products via Public API
   */
  static async listProducts(workspaceId: string, limit = 50, offset = 0) {
    const { data, error, count } = await supabaseAdmin
      .from('products')
      .select('id, sku, name, description, unit, cost_price, selling_price, is_active, created_at', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .range(offset, offset + limit - 1)
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    return { products: data, total: count };
  }

  /**
   * List inventory balances per SKU via Public API.
   * Phase 7: quantity_available comes from THE single available-stock formula
   * (on-hand minus reservations) — never a locally re-derived number.
   */
  static async listInventory(workspaceId: string) {
    const { data, error } = await supabaseAdmin
      .from('inventory')
      .select(`
        id,
        quantity,
        reserved_quantity,
        product:products (
          id,
          sku,
          name
        ),
        warehouse:warehouses (
          id,
          name,
          code
        )
      `)
      .eq('workspace_id', workspaceId);

    if (error) throw new Error(error.message);

    return (data || []).map((row: any) => ({
      id: row.id,
      quantity_on_hand: row.quantity,
      quantity_reserved: row.reserved_quantity || 0,
      quantity_available: InventoryService.availableQuantity(row),
      product: row.product,
      warehouse: row.warehouse,
    }));
  }

  /**
   * Ingest eCommerce order (e.g. from Shopify / WooCommerce / Custom POS)
   */
  static async ingestExternalOrder(
    workspaceId: string,
    orderPayload: {
      external_order_id: string;
      customer_name: string;
      customer_email?: string;
      items: { sku: string; quantity: number; unit_price: number }[];
    }
  ) {
    // 1. Resolve or create customer
    let customerId: string | null = null;
    const { data: existingCustomer } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('name', orderPayload.customer_name)
      .maybeSingle();

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const { data: newCust, error: custErr } = await supabaseAdmin
        .from('customers')
        .insert({
          workspace_id: workspaceId,
          name: orderPayload.customer_name,
          email: orderPayload.customer_email || 'external@store.com',
        })
        .select()
        .single();

      if (!custErr && newCust) {
        customerId = newCust.id;
      }
    }

    // 2. Resolve default warehouse
    const { data: warehouse } = await supabaseAdmin
      .from('warehouses')
      .select('id')
      .eq('workspace_id', workspaceId)
      .limit(1)
      .single();

    if (!warehouse) throw new Error('No warehouse found for order fulfillment');

    // 3. Resolve products and build items
    const orderItems: any[] = [];
    let totalAmount = 0;

    for (const item of orderPayload.items) {
      const { data: prod } = await supabaseAdmin
        .from('products')
        .select('id, cost_price')
        .eq('workspace_id', workspaceId)
        .eq('sku', item.sku)
        .single();

      if (!prod) {
        throw new Error(`Product with SKU ${item.sku} not found`);
      }

      const itemTotal = item.quantity * item.unit_price;
      totalAmount += itemTotal;

      orderItems.push({
        product_id: prod.id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: itemTotal,
      });
    }

    // 4. Create Sales Order
    const orderNumber = `EXT-${orderPayload.external_order_id.slice(-6).toUpperCase()}-${Date.now().toString().slice(-4)}`;

    const { data: salesOrder, error: soErr } = await supabaseAdmin
      .from('sales_orders')
      .insert({
        workspace_id: workspaceId,
        order_number: orderNumber,
        customer_id: customerId,
        warehouse_id: warehouse.id,
        status: 'processing',
        payment_status: 'paid',
        total_amount: totalAmount,
        notes: `Ingested via Public REST API (Ref: ${orderPayload.external_order_id})`,
      })
      .select()
      .single();

    if (soErr || !salesOrder) throw new Error(soErr?.message || 'Failed to create sales order');

    // Insert order items
    const itemsToInsert = orderItems.map((it) => ({
      ...it,
      sales_order_id: salesOrder.id,
    }));

    await supabaseAdmin.from('sales_order_items').insert(itemsToInsert);

    // Deduces stock via Central Inventory Engine
    for (const item of orderItems) {
      await InventoryService.adjustStock({
        workspaceId,
        productId: item.product_id,
        warehouseId: warehouse.id,
        qtyChange: -item.quantity,
        movementType: 'sales_shipped',
        referenceType: 'SALES_ORDER',
        referenceId: salesOrder.id,
        userId: '00000000-0000-0000-0000-000000000000',
        notes: `Public API Order Ingestion ${orderNumber}`,
      });
    }

    return {
      order_id: salesOrder.id,
      order_number: orderNumber,
      status: salesOrder.status,
      total_amount: totalAmount,
    };
  }
}
