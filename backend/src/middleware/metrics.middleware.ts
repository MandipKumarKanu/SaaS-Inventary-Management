/**
 * Lightweight in-process request metrics (Phase 0 fix).
 * Replaces the previously hard-coded fake metrics in MonitoringService.getMetrics()
 * with real, measured data (PRD §71/§75: never fabricate production statistics).
 *
 * Deliberately dependency-free and bounded in memory:
 *  - counters for total / 4xx / 5xx
 *  - a bounded ring of recent request durations for percentile estimates
 *  - a per-minute counter for requests/minute
 */

const MAX_LATENCY_SAMPLES = 1000;

const state = {
  totalRequests: 0,
  clientErrors: 0, // 4xx
  serverErrors: 0, // 5xx
  requestsThisMinute: 0,
  currentMinute: Math.floor(Date.now() / 60_000),
  latencySamplesMs: [] as number[],
};

export function metricsMiddleware(req: { path: string }, res: { statusCode?: number; on: Function }, next: Function): void {
  // Skip root/health probes so uptime checks don't skew the numbers
  if (req.path === '/' || req.path === '/api/health') {
    next();
    return;
  }

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const status = res.statusCode || 0;

    state.totalRequests += 1;

    const minute = Math.floor(Date.now() / 60_000);
    if (minute !== state.currentMinute) {
      state.currentMinute = minute;
      state.requestsThisMinute = 0;
    }
    state.requestsThisMinute += 1;

    if (status >= 500) state.serverErrors += 1;
    else if (status >= 400) state.clientErrors += 1;

    state.latencySamplesMs.push(durationMs);
    if (state.latencySamplesMs.length > MAX_LATENCY_SAMPLES) {
      state.latencySamplesMs.shift();
    }
  });

  next();
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

export function getMetricsSnapshot() {
  const sorted = [...state.latencySamplesMs].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 100) / 100;
  const total = state.totalRequests;

  return {
    requests_total: total,
    requests_per_minute: state.requestsThisMinute,
    p50_latency_ms: round(percentile(sorted, 0.5)),
    p95_latency_ms: round(percentile(sorted, 0.95)),
    p99_latency_ms: round(percentile(sorted, 0.99)),
    client_errors_4xx: state.clientErrors,
    server_errors_5xx: state.serverErrors,
    error_rate_percent: total === 0 ? 0 : round(((state.clientErrors + state.serverErrors) / total) * 100),
  };
}

export function resetMetricsForTests(): void {
  state.totalRequests = 0;
  state.clientErrors = 0;
  state.serverErrors = 0;
  state.requestsThisMinute = 0;
  state.currentMinute = Math.floor(Date.now() / 60_000);
  state.latencySamplesMs = [];
}
