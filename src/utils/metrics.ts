/**
 * Lightweight in-process metrics collector.
 * Tracks counters, gauges, and histograms for observability.
 */

export interface MetricSnapshot {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    histograms: Record<string, { count: number; sum: number; min: number; max: number; avg: number }>;
    uptime_seconds: number;
}

class MetricsCollector {
    private counters = new Map<string, number>();
    private gauges = new Map<string, number>();
    private histograms = new Map<string, { count: number; sum: number; min: number; max: number }>();
    private startTime = Date.now();

    /** Increment a counter (e.g. total_requests, tool_calls) */
    increment(name: string, amount: number = 1): void {
        this.counters.set(name, (this.counters.get(name) || 0) + amount);
    }

    /** Set a gauge to a specific value (e.g. active_sessions) */
    gauge(name: string, value: number): void {
        this.gauges.set(name, value);
    }

    /** Record a histogram observation (e.g. response_time_ms) */
    observe(name: string, value: number): void {
        const existing = this.histograms.get(name);
        if (existing) {
            existing.count++;
            existing.sum += value;
            existing.min = Math.min(existing.min, value);
            existing.max = Math.max(existing.max, value);
        } else {
            this.histograms.set(name, { count: 1, sum: value, min: value, max: value });
        }
    }

    /** Convenience: time an async operation and record it */
    async timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
        const start = performance.now();
        try {
            return await fn();
        } finally {
            this.observe(name, performance.now() - start);
        }
    }

    /** Get a snapshot of all metrics */
    snapshot(): MetricSnapshot {
        const histograms: MetricSnapshot['histograms'] = {};
        for (const [name, h] of this.histograms) {
            histograms[name] = {
                count: h.count,
                sum: h.sum,
                min: h.min,
                max: h.max,
                avg: h.count > 0 ? h.sum / h.count : 0,
            };
        }

        return {
            counters: Object.fromEntries(this.counters),
            gauges: Object.fromEntries(this.gauges),
            histograms,
            uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
        };
    }

    /** Reset all metrics */
    reset(): void {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
        this.startTime = Date.now();
    }
}

/** Singleton metrics instance */
export const metrics = new MetricsCollector();
