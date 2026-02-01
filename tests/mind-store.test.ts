import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { MindStore } from '../src/mind/store.js';

describe('MindStore', () => {
    let db: Database.Database;
    let store: MindStore;

    beforeEach(() => {
        db = new Database(':memory:');
        store = new MindStore(db);
    });

    describe('log operations', () => {
        it('adds and retrieves logs by category', () => {
            store.addLog('stress', { context: 'user frustrated', intensity: 4 });
            store.addLog('confession', { context: 'uncertain answer' });
            store.addLog('stress', { context: 'repeated error', intensity: 2 });

            const stressLogs = store.getLogs('stress');
            expect(stressLogs).toHaveLength(2);
            // getLogs returns DESC order
            expect(stressLogs[0].payload.context).toBe('repeated error');

            const confessionLogs = store.getLogs('confession');
            expect(confessionLogs).toHaveLength(1);
        });

        it('filters logs by time window', () => {
            store.addLog('stress', { context: 'recent' });

            // Insert an old log directly
            const oldTime = Date.now() - (10 * 24 * 60 * 60 * 1000); // 10 days ago
            db.prepare('INSERT INTO mind_log (category, payload, created_at) VALUES (?, ?, ?)').run(
                'stress', JSON.stringify({ context: 'old' }), oldTime
            );

            const recentLogs = store.getLogs('stress', 7);
            expect(recentLogs).toHaveLength(1);
            expect(recentLogs[0].payload.context).toBe('recent');

            const allLogs = store.getLogs('stress', 30);
            expect(allLogs).toHaveLength(2);
        });

        it('counts logs correctly', () => {
            store.addLog('stress', { x: 1 });
            store.addLog('stress', { x: 2 });
            store.addLog('ethics', { x: 3 });

            expect(store.getLogCount(7)).toBe(3);
        });
    });

    describe('learning operations', () => {
        it('adds and retrieves learnings', () => {
            const id = store.addLearning('Test Learning', 'Content here', 'Rationale');
            expect(id).toBeGreaterThan(0);

            const pending = store.getPendingLearnings();
            expect(pending).toHaveLength(1);
            expect(pending[0].title).toBe('Test Learning');
            expect(pending[0].approved).toBeFalsy();
        });

        it('approves and retrieves approved learnings', () => {
            const id = store.addLearning('To Approve', 'Content', 'Rationale');
            store.approveLearning(id);

            const approved = store.getApprovedLearnings();
            expect(approved).toHaveLength(1);
            expect(approved[0].title).toBe('To Approve');
            expect(approved[0].approved).toBeTruthy();
        });

        it('rejects (deletes) learnings', () => {
            const id = store.addLearning('To Reject', 'Content', 'Rationale');
            store.rejectLearning(id);

            expect(store.getPendingLearnings()).toHaveLength(0);
        });
    });

    describe('relevance decay', () => {
        it('decays all approved learnings by 0.95', () => {
            const id = store.addLearning('Decaying', 'Content', 'Rationale', true);

            store.applyDecay();

            const learnings = store.getApprovedLearnings();
            expect(learnings[0].relevance_score).toBeCloseTo(0.95, 2);
        });

        it('prunes learnings below 0.1 threshold', () => {
            const id = store.addLearning('Will Prune', 'Content', 'Rationale', true);

            // Set relevance very low
            db.prepare('UPDATE mind_learnings SET relevance_score = 0.09 WHERE id = ?').run(id);

            const pruned = store.applyDecay();
            expect(pruned).toBe(1);
            expect(store.getApprovedLearnings()).toHaveLength(0);
        });

        it('boosts relevance on activation', () => {
            const id = store.addLearning('Activated', 'Content', 'Rationale', true);

            // Decay it first
            store.applyDecay(); // 1.0 * 0.95 = 0.95

            store.activateLearning(id);
            const learnings = store.getApprovedLearnings();
            // 0.95 + 0.15 = 1.10, capped at 1.0
            expect(learnings[0].relevance_score).toBeCloseTo(1.0, 2);
            expect(learnings[0].activation_count).toBe(1);
        });
    });

    describe('dream operations', () => {
        it('records and retrieves dreams', () => {
            store.recordDream(7, 15, 'Proposed learning: be more concise');

            const dreams = store.getRecentDreams();
            expect(dreams).toHaveLength(1);
            expect(dreams[0].days_analyzed).toBe(7);
            expect(dreams[0].log_count).toBe(15);
        });
    });

    describe('formatted output', () => {
        it('formats approved learnings for system prompt', () => {
            store.addLearning('Be Concise', 'Keep responses under 200 words', 'Users prefer brevity', true);
            store.addLearning('Use Spanish', 'Respond in Spanish when user writes in Spanish', 'Language preference', true);

            const formatted = store.formatApprovedLearnings();
            expect(formatted).toContain('Be Concise');
            expect(formatted).toContain('Use Spanish');
            expect(formatted).toContain('relevance: 100%');
        });

        it('returns placeholder when no learnings', () => {
            expect(store.formatApprovedLearnings()).toBe('*No approved learnings yet.*');
        });
    });
});
