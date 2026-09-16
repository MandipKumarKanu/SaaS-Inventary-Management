import { supabaseAdmin } from '../../config/supabase.js';
import { InventoryService } from '../inventory/inventory.service.js';

export class SeedingService {
  static async seedDemoData(workspaceId: string, userId: string) {
    // 1. Create Demo Categories
    const { data: cat1 } = await supabaseAdmin.from('categories').insert({ workspace_id: workspaceId, name: 'Consumer Electronics' }).select().single();
    const { data: cat2 } = await supabaseAdmin.from('categories').insert({ workspace_id: workspaceId, name: 'Office Supplies' }).select().single();

    // 2. Create Demo Warehouses
    const { data: wh1 } = await supabaseAdmin.from('warehouses').insert({ workspace_id: workspaceId, name: 'Primary Distribution Center', code: 'WH-EAST', address: '100 Logistics Way, NY' }).select().single();
    const { data: wh2 } = await supabaseAdmin.from('warehouses').insert({ workspace_id: workspaceId, name: 'Secondary Hub', code: 'WH-WEST', address: '500 Harbor Blvd, CA' }).select().single();

    if (!wh1) throw new Error('Failed to seed demo warehouse');

    // 3. Create Demo Products
    const demoProducts = [
      { workspace_id: workspaceId, category_id: cat1?.id, sku: 'SKU-MACBOOK-PRO-16', name: 'MacBook Pro 16" M3 Max', unit: 'Pcs', cost_price: 2800.00, selling_price: 3499.00, min_stock: 5, reorder_point: 10 },
      { workspace_id: workspaceId, category_id: cat1?.id, sku: 'SKU-DELL-XPS-15', name: 'Dell XPS 15 OLED', unit: 'Pcs', cost_price: 1500.00, selling_price: 1999.00, min_stock: 5, reorder_point: 8 },
      { workspace_id: workspaceId, category_id: cat1?.id, sku: 'SKU-SONY-WH1000XM5', name: 'Sony WH-1000XM5 Noise Canceling Headphones', unit: 'Pcs', cost_price: 250.00, selling_price: 399.00, min_stock: 15, reorder_point: 25 },
      { workspace_id: workspaceId, category_id: cat2?.id, sku: 'SKU-DESK-CHAIR-ERGO', name: 'Ergonomic Mesh Executive Chair', unit: 'Pcs', cost_price: 180.00, selling_price: 349.00, min_stock: 10, reorder_point: 15 },
      { workspace_id: workspaceId, category_id: cat2?.id, sku: 'SKU-MONITOR-34-CURVED', name: 'UltraWide 34" Curved Monitor 144Hz', unit: 'Pcs', cost_price: 400.00, selling_price: 699.00, min_stock: 8, reorder_point: 12 },
    ];

    const { data: insertedProds } = await supabaseAdmin.from('products').insert(demoProducts).select();

    // 4. Seed Stock Balances via Central Inventory Engine
    if (insertedProds && insertedProds.length > 0) {
      for (const prod of insertedProds) {
        await InventoryService.adjustStock({
          workspaceId,
          productId: prod.id,
          warehouseId: wh1.id,
          qtyChange: Math.floor(Math.random() * 40) + 15,
          movementType: 'opening_balance',
          userId,
          notes: 'Initial Demo Data Opening Stock Seeder',
        });
      }
    }

    // 5. Create Demo Suppliers & Customers
    await supabaseAdmin.from('suppliers').insert([
      { workspace_id: workspaceId, name: 'Global Tech Distribution Inc', contact_email: 'sales@globaltech.com', phone: '+1 800 555 0199' },
      { workspace_id: workspaceId, name: 'Apex Logistics Hardware Co', contact_email: 'orders@apexhardware.com', phone: '+1 800 555 0288' },
    ]);

    await supabaseAdmin.from('customers').insert([
      { workspace_id: workspaceId, name: 'Acme Corporation', email: 'purchasing@acmecorp.com', phone: '+1 555 014 9920' },
      { workspace_id: workspaceId, name: 'Stark Industries', email: 'orders@stark.io', phone: '+1 555 019 3321' },
    ]);

    return {
      message: 'Demo dataset seeded successfully!',
      seeded_summary: {
        products_created: insertedProds?.length || 0,
        warehouses_created: 2,
        suppliers_created: 2,
        customers_created: 2,
      },
    };
  }
}
