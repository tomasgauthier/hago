import { describe, it, expect, beforeEach } from 'vitest';
import { metrics } from '../src/utils/metrics.js';

describe('MetricsCollector', () => {
    beforeEach(() => {
        metrics.reset();
    });

    describe('counters', () => {
        it('increments counters', () => {
            metrics.increment('requests');
            metrics.increment('requests');
            metrics.increment('errors', 3);

            const snap = metrics.snapshot();
            expect(snap.counters.requests).toBe(2);
            expect(snap.counters.errors).toBe(3);
        });
    });

    describe('gauges', () => {
        it('sets gauge values', () => {
            metrics.gauge('active_sessions', 5);
            metrics.gauge('active_sessions', 3);

            const snap = metrics.snapshot();
            expect(snap.gauges.active_sessions).toBe(3);
        });
    });

    describe('histograms', () => {
        it('records observations with stats', () => {
            metrics.observe('response_ms', 100);
            metrics.observe('response_ms', 200);
            metrics.observe('response_ms', 300);

            const snap = metrics.snapshot();
            const h = snap.histograms.response_ms;
            expect(h.count).toBe(3);
            expect(h.min).toBe(100);
            expect(h.max).toBe(300);
            expect(h.avg).toBe(200);
            expect(h.sum).toBe(600);
        });
    });

    describe('timeAsync', () => {
        it('times async operations', async () => {
            const result = await metrics.timeAsync('test_op', async () => {
                await new Promise(r => setTimeout(r, 50));
                return 42;
            });

            expect(result).toBe(42);
            const snap = metrics.snapshot();
            expect(snap.histograms.test_op.count).toBe(1);
            expect(snap.histograms.test_op.min).toBeGreaterThan(40);
        });
    });

    describe('snapshot', () => {
        it('includes uptime', () => {
            const snap = metrics.snapshot();
            expect(snap.uptime_seconds).toBeGreaterThanOrEqual(0);
        });
    });
});
