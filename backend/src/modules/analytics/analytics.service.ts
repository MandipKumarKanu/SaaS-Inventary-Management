import { supabaseAdmin } from '../../config/supabase.js';

export class AnalyticsService {
  /**
   * ABC Inventory Classification
   * Class A: Top 70% cumulative value
   * Class B: Next 20% cumulative value (70-90%)
   * Class C: Remaining 10% value (90-100%)
   */
  static async getABCAnalysis(workspaceId: string) {
    const { data: products, error: pErr } = await supabaseAdmin
      .from('products')
      .select('id, name, sku, unit, cost_price, selling_price, category:categories(name)')
      .eq('workspace_id', workspaceId);

    if (pErr) throw pErr;

    const { data: stockLevels, error: sErr } = await supabaseAdmin
      .from('inventory')
      .select('product_id, quantity')
      .eq('workspace_id', workspaceId);

    if (sErr) throw sErr;

    // Sum stock by product
    const stockMap: Record<string, number> = {};
    (stockLevels || []).forEach((lvl) => {
      stockMap[lvl.product_id] = (stockMap[lvl.product_id] || 0) + (lvl.quantity || 0);
    });

    // Calculate asset value per product
    const items = (products || []).map((p) => {
      const currentQty = stockMap[p.id] || 0;
      const assetValue = currentQty * (p.cost_price || 0);
      return {
        product: p,
        currentQty,
        costPrice: p.cost_price || 0,
        assetValue,
      };
    });

    // Sort by assetValue descending
    items.sort((a, b) => b.assetValue - a.assetValue);

    const totalValuation = items.reduce((acc, item) => acc + item.assetValue, 0);

    let cumulativeValue = 0;
    const classifiedItems = items.map((item) => {
      cumulativeValue += item.assetValue;
      const cumulativePct = totalValuation > 0 ? (cumulativeValue / totalValuation) * 100 : 100;

      let categoryClass: 'A' | 'B' | 'C' = 'C';
      let policyRecommendation = 'Bulk reorder with minimal safety stock';

      if (cumulativePct <= 70 || (totalValuation === 0 && items.indexOf(item) < items.length * 0.2)) {
        categoryClass = 'A';
        policyRecommendation = 'Tight inventory control, frequent cycle counts, low safety stock';
      } else if (cumulativePct <= 90) {
        categoryClass = 'B';
        policyRecommendation = 'Moderate control, periodic review, standard safety stock';
      }

      return {
        ...item,
        cumulativePct: Number(cumulativePct.toFixed(2)),
        categoryClass,
        policyRecommendation,
      };
    });

    const summary = {
      classA: classifiedItems.filter((i) => i.categoryClass === 'A'),
      classB: classifiedItems.filter((i) => i.categoryClass === 'B'),
      classC: classifiedItems.filter((i) => i.categoryClass === 'C'),
      totalValuation,
    };

    return summary;
  }

  /**
   * Predictive Demand Forecasting & Stockout Risk
   */
  static async getDemandForecast(workspaceId: string, daysPeriod: number = 30) {
    const { data: products, error: pErr } = await supabaseAdmin
      .from('products')
      .select('id, name, sku, unit, reorder_point, cost_price')
      .eq('workspace_id', workspaceId);

    if (pErr) throw pErr;

    const { data: stockLevels } = await supabaseAdmin
      .from('inventory')
      .select('product_id, quantity')
      .eq('workspace_id', workspaceId);

    // Sum stock by product
    const stockMap: Record<string, number> = {};
    (stockLevels || []).forEach((lvl) => {
      stockMap[lvl.product_id] = (stockMap[lvl.product_id] || 0) + (lvl.quantity || 0);
    });

    // Fetch past sales shipped transactions over period
    const startDate = new Date(Date.now() - daysPeriod * 24 * 60 * 60 * 1000).toISOString();
    const { data: salesHistory } = await supabaseAdmin
      .from('inventory_transactions')
      .select('product_id, quantity_change')
      .eq('workspace_id', workspaceId)
      .eq('movement_type', 'sales_shipped')
      .gte('created_at', startDate);

    const salesMap: Record<string, number> = {};
    (salesHistory || []).forEach((tx) => {
      salesMap[tx.product_id] = (salesMap[tx.product_id] || 0) + Math.abs(tx.quantity_change);
    });

    const forecasts = (products || []).map((p) => {
      const currentStock = stockMap[p.id] || 0;
      const totalUnitsSold = salesMap[p.id] || 0;
      const dailyDemandRate = totalUnitsSold / daysPeriod;

      let daysUntilStockout: number | null = null;
      let projectedStockoutDate: string | null = null;

      if (dailyDemandRate > 0) {
        daysUntilStockout = Math.floor(currentStock / dailyDemandRate);
        const stockoutDate = new Date(Date.now() + daysUntilStockout * 24 * 60 * 60 * 1000);
        projectedStockoutDate = stockoutDate.toISOString().split('T')[0];
      }

      return {
        product: p,
        currentStock,
        periodDays: daysPeriod,
        totalUnitsSold,
        dailyDemandRate: Number(dailyDemandRate.toFixed(2)),
        daysUntilStockout,
        projectedStockoutDate,
        riskLevel: currentStock === 0 ? 'CRITICAL_STOCKOUT' : (daysUntilStockout !== null && daysUntilStockout <= 7) ? 'HIGH_RISK' : (daysUntilStockout !== null && daysUntilStockout <= 30) ? 'MODERATE_RISK' : 'HEALTHY',
      };
    });

    forecasts.sort((a, b) => (a.daysUntilStockout ?? 9999) - (b.daysUntilStockout ?? 9999));

    return forecasts;
  }

  /**
   * Executive Reporting Summary
   */
  static async getExecutiveReport(workspaceId: string) {
    const [abc, forecast] = await Promise.all([
      this.getABCAnalysis(workspaceId),
      this.getDemandForecast(workspaceId, 30),
    ]);

    const { data: warehouses } = await supabaseAdmin
      .from('warehouses')
      .select('id, name, code')
      .eq('workspace_id', workspaceId);

    const { data: transactions } = await supabaseAdmin
      .from('inventory_transactions')
      .select('movement_type, quantity_change')
      .eq('workspace_id', workspaceId);

    const movementSummary: Record<string, number> = {};
    (transactions || []).forEach((t) => {
      movementSummary[t.movement_type] = (movementSummary[t.movement_type] || 0) + Math.abs(t.quantity_change);
    });

    return {
      totalValuation: abc.totalValuation,
      totalSKUs: abc.classA.length + abc.classB.length + abc.classC.length,
      classASKUs: abc.classA.length,
      classBSKUs: abc.classB.length,
      classCSKUs: abc.classC.length,
      highRiskStockouts: forecast.filter((f) => f.riskLevel === 'CRITICAL_STOCKOUT' || f.riskLevel === 'HIGH_RISK').length,
      warehousesCount: (warehouses || []).length,
      movementSummary,
    };
  }
}
