import { supabaseAdmin } from '../../config/supabase.js';
import { CacheService } from '../../services/cache.service.js';
import { BackgroundWorkerService } from '../../services/worker.service.js';

export class MonitoringService {
  static async getSystemHealth() {
    const startTime = Date.now();
    let dbStatus = 'healthy';
    let dbLatencyMs = 0;

    try {
      await supabaseAdmin.from('workspaces').select('id').limit(1);
      dbLatencyMs = Date.now() - startTime;
    } catch (err) {
      dbStatus = 'unhealthy';
    }

    const memory = process.memoryUsage();
    const cacheStats = CacheService.getStats();
    const jobLogs = await BackgroundWorkerService.getJobLogs(5);

    return {
      status: dbStatus === 'healthy' ? 'operational' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime_seconds: process.uptime(),
      database: {
        status: dbStatus,
        latency_ms: dbLatencyMs,
      },
      memory: {
        rss_mb: +(memory.rss / (1024 * 1024)).toFixed(2),
        heap_used_mb: +(memory.heapUsed / (1024 * 1024)).toFixed(2),
        heap_total_mb: +(memory.heapTotal / (1024 * 1024)).toFixed(2),
      },
      cache: cacheStats,
      recent_worker_jobs: jobLogs,
    };
  }

  // Real metrics now come from the request-collecting middleware
  // (see metrics.middleware.ts). The previous hard-coded values were removed
  // (PRD §71/§75: never fabricate production statistics).
}
