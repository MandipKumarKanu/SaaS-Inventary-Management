import { supabaseAdmin } from '../../config/supabase.js';

export class AICopilotService {
  static async chat(workspaceId: string, userMessage: string) {
    const prompt = userMessage.toLowerCase();

    // Fetch workspace context for intelligent reasoning
    const [
      { data: products },
      { data: inventory },
      { data: warehouses },
      { data: movements },
    ] = await Promise.all([
      supabaseAdmin.from('products').select('*').eq('workspace_id', workspaceId),
      supabaseAdmin.from('inventory').select('*').eq('workspace_id', workspaceId),
      supabaseAdmin.from('warehouses').select('*').eq('workspace_id', workspaceId),
      supabaseAdmin
        .from('inventory_transactions')
        .select('qty_change, movement_type, created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    const totalProducts = products?.length || 0;
    const qtyByProduct = new Map<string, number>();
    for (const inv of inventory || []) {
      qtyByProduct.set(inv.product_id, (qtyByProduct.get(inv.product_id) || 0) + (inv.quantity || 0));
    }
    const lowStockItems = (products || []).filter(
      (p) => (qtyByProduct.get(p.id) || 0) <= (p.reorder_point || 10)
    );
    const overstockItems = (products || []).filter(
      (p) => (qtyByProduct.get(p.id) || 0) > (p.reorder_point || 10) * 4
    );
    const totalValuation = (products || []).reduce(
      (acc, p) => acc + (qtyByProduct.get(p.id) || 0) * (p.cost_price || 0),
      0
    );

    let aiReply = '';
    let suggestedActions: any[] = [];

    if (prompt.includes('reorder') || prompt.includes('low stock') || prompt.includes('stockout')) {
      aiReply = `I analyzed your active catalog of **${totalProducts} SKUs**. Currently, **${lowStockItems.length} items** are at or below their configured reorder points.\n\nRecommended Action: Draft Purchase Orders for items with critical depletion trajectory.`;

      suggestedActions = lowStockItems.map((item) => ({
        type: 'DRAFT_PO',
        label: `Draft Purchase Order for ${item.name} (${item.sku})`,
        sku: item.sku,
        recommended_qty: (item.reorder_point || 10) * 2,
      }));
    } else if (prompt.includes('valuation') || prompt.includes('asset') || prompt.includes('worth')) {
      aiReply = `Your total inventory asset valuation across **${warehouses?.length || 1} storage facilities** is **$${totalValuation.toLocaleString(undefined, { minimumFractionDigits: 2 })}**.`;
    } else if (
      prompt.includes('warehouse') ||
      prompt.includes('warehouses') ||
      prompt.includes('facilit') ||
      prompt.includes('where')
    ) {
      const lines = (warehouses || []).map((w) => {
        const skuCount = (inventory || []).filter((i) => i.warehouse_id === w.id).length;
        const units = (inventory || [])
          .filter((i) => i.warehouse_id === w.id)
          .reduce((acc, i) => acc + (i.quantity || 0), 0);
        return `- **${w.name}** (${w.code || 'no code'}): ${skuCount} SKU records, ${units.toLocaleString()} units on hand`;
      });
      aiReply =
        lines.length > 0
          ? `You operate **${warehouses?.length} storage facilities**:\n\n${lines.join('\n')}`
          : `You have no warehouses set up yet. Create one to start tracking stock balances.`;
    } else if (
      prompt.includes('overstock') ||
      prompt.includes('excess') ||
      prompt.includes('dead stock') ||
      prompt.includes('deadstock') ||
      prompt.includes('slow')
    ) {
      const top = overstockItems.slice(0, 10);
      aiReply =
        top.length > 0
          ? `I found **${overstockItems.length} overstocked SKUs** (on hand above 4× reorder point). Top candidates to review:\n\n${top
              .map((p) => `- **${p.name}** (${p.sku}): ${qtyByProduct.get(p.id)} units`)
              .join('\n')}`
          : `No overstock detected — every SKU is within 4× of its reorder point.`;
    } else if (
      prompt.includes('movement') ||
      prompt.includes('activit') ||
      prompt.includes('recent') ||
      prompt.includes('trend')
    ) {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recent = (movements || []).filter((m) => new Date(m.created_at).getTime() >= weekAgo);
      const inbound = recent
        .filter((m) => (m.qty_change || 0) > 0)
        .reduce((acc, m) => acc + (m.qty_change || 0), 0);
      const outbound = recent
        .filter((m) => (m.qty_change || 0) < 0)
        .reduce((acc, m) => acc + Math.abs(m.qty_change || 0), 0);
      aiReply = `In the last 7 days there were **${recent.length} stock movements**: **${inbound.toLocaleString()} units received** and **${outbound.toLocaleString()} units shipped**.`;
    } else {
      aiReply = `I am your AI Stockflow Copilot. I constantly monitor your **${totalProducts} SKUs**, warehouse movements, and depletion rates. You can ask me to identify low stock, evaluate asset valuation, break down warehouses, flag overstock, or summarize recent movements!`;
    }

    return {
      reply: aiReply,
      timestamp: new Date().toISOString(),
      suggested_actions: suggestedActions,
    };
  }
}
