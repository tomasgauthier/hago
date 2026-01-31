/**
 * MindStore — SQLite-backed storage for the spiritual biology system.
 * Replaces the .mind/ filesystem approach with structured, queryable data.
 */

import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

// ── Types ────────────────────────────────────────────────────────────

export type MindLogCategory = 'stress' | 'confession' | 'ethics' | 'guidance';

export interface MindLogEntry {
    id: number;
    category: MindLogCategory;
    payload: Record<string, unknown>;
    created_at: number;
}

export interface MindLearning {
    id: number;
    title: string;
    content: string;
    rationale: string;
    relevance_score: number;
    activation_count: number;
    last_activated: number;
    approved: boolean;
    created_at: number;
}

export interface DreamResult {
    id: number;
    days_analyzed: number;
    log_count: number;
    proposals: string;
    created_at: number;
}

// ── Constants ────────────────────────────────────────────────────────

const DECAY_FACTOR = 0.95;         // Applied per dream phase
const MIN_RELEVANCE = 0.1;         // Below this, learning is pruned
const REACTIVATION_BOOST = 0.15;   // Boost when a learning is matched

// ── MindStore ────────────────────────────────────────────────────────

export class MindStore {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.init();
    }

    private init() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS mind_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS mind_learnings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                rationale TEXT NOT NULL DEFAULT '',
                relevance_score REAL NOT NULL DEFAULT 1.0,
                activation_count INTEGER NOT NULL DEFAULT 0,
                last_activated INTEGER NOT NULL DEFAULT 0,
                approved INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS mind_dreams (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                days_analyzed INTEGER NOT NULL,
                log_count INTEGER NOT NULL DEFAULT 0,
                proposals TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_mind_log_category ON mind_log(category);
            CREATE INDEX IF NOT EXISTS idx_mind_log_created ON mind_log(created_at);
            CREATE INDEX IF NOT EXISTS idx_mind_learnings_approved ON mind_learnings(approved);
        `);

        logger.info('[MindStore] Initialized SQLite tables');
    }

    // ── Log operations ───────────────────────────────────────────────

    addLog(category: MindLogCategory, payload: Record<string, unknown>): number {
        const now = Date.now();
        const result = this.db.prepare(
            'INSERT INTO mind_log (category, payload, created_at) VALUES (?, ?, ?)'
        ).run(category, JSON.stringify(payload), now);
        return result.lastInsertRowid as number;
    }

    getLogs(category: MindLogCategory, sinceDaysAgo: number = 7): MindLogEntry[] {
        const since = Date.now() - (sinceDaysAgo * 24 * 60 * 60 * 1000);
        const rows = this.db.prepare(
            'SELECT id, category, payload, created_at FROM mind_log WHERE category = ? AND created_at >= ? ORDER BY created_at DESC'
        ).all(category, since) as any[];

        return rows.map(r => ({
            ...r,
            payload: JSON.parse(r.payload),
        }));
    }

    getAllLogs(sinceDaysAgo: number = 7): MindLogEntry[] {
        const since = Date.now() - (sinceDaysAgo * 24 * 60 * 60 * 1000);
        const rows = this.db.prepare(
            'SELECT id, category, payload, created_at FROM mind_log WHERE created_at >= ? ORDER BY created_at DESC'
        ).all(since) as any[];

        return rows.map(r => ({
            ...r,
            payload: JSON.parse(r.payload),
        }));
    }

    getLogCount(sinceDaysAgo: number = 7): number {
        const since = Date.now() - (sinceDaysAgo * 24 * 60 * 60 * 1000);
        const row = this.db.prepare(
            'SELECT COUNT(*) as count FROM mind_log WHERE created_at >= ?'
        ).get(since) as any;
        return row.count;
    }

    // ── Learning operations ──────────────────────────────────────────

    addLearning(title: string, content: string, rationale: string, approved: boolean = false): number {
        const now = Date.now();
        const result = this.db.prepare(
            'INSERT INTO mind_learnings (title, content, rationale, approved, created_at, last_activated) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(title, content, rationale, approved ? 1 : 0, now, now);
        return result.lastInsertRowid as number;
    }

    approveLearning(id: number): void {
        this.db.prepare('UPDATE mind_learnings SET approved = 1 WHERE id = ?').run(id);
    }

    rejectLearning(id: number): void {
        this.db.prepare('DELETE FROM mind_learnings WHERE id = ?').run(id);
    }

    getApprovedLearnings(): MindLearning[] {
        return this.db.prepare(
            'SELECT * FROM mind_learnings WHERE approved = 1 ORDER BY relevance_score DESC'
        ).all() as MindLearning[];
    }

    getPendingLearnings(): MindLearning[] {
        return this.db.prepare(
            'SELECT * FROM mind_learnings WHERE approved = 0 ORDER BY created_at DESC'
        ).all() as MindLearning[];
    }

    /**
     * Activate a learning — boosts its relevance score when it matches current context.
     */
    activateLearning(id: number): void {
        const now = Date.now();
        this.db.prepare(`
            UPDATE mind_learnings
            SET relevance_score = MIN(1.0, relevance_score + ?),
                activation_count = activation_count + 1,
                last_activated = ?
            WHERE id = ?
        `).run(REACTIVATION_BOOST, now, id);
    }

    /**
     * Apply decay to all approved learnings. Called during dream phase.
     * Returns count of pruned learnings.
     */
    applyDecay(): number {
        // Decay all approved learnings
        this.db.prepare(`
            UPDATE mind_learnings
            SET relevance_score = relevance_score * ?
            WHERE approved = 1
        `).run(DECAY_FACTOR);

        // Prune learnings below minimum relevance
        const pruned = this.db.prepare(`
            DELETE FROM mind_learnings
            WHERE approved = 1 AND relevance_score < ?
        `).run(MIN_RELEVANCE);

        if (pruned.changes > 0) {
            logger.info(`[MindStore] Pruned ${pruned.changes} low-relevance learnings`);
        }

        return pruned.changes;
    }

    // ── Dream operations ─────────────────────────────────────────────

    recordDream(daysAnalyzed: number, logCount: number, proposals: string): number {
        const now = Date.now();
        const result = this.db.prepare(
            'INSERT INTO mind_dreams (days_analyzed, log_count, proposals, created_at) VALUES (?, ?, ?, ?)'
        ).run(daysAnalyzed, logCount, proposals, now);
        return result.lastInsertRowid as number;
    }

    getRecentDreams(limit: number = 5): DreamResult[] {
        return this.db.prepare(
            'SELECT * FROM mind_dreams ORDER BY created_at DESC LIMIT ?'
        ).all(limit) as DreamResult[];
    }

    // ── Formatted output for LLM consumption ─────────────────────────

    formatLogsForDream(daysBack: number = 7): string {
        const categories: MindLogCategory[] = ['stress', 'confession', 'ethics', 'guidance'];
        const sections: string[] = [];

        for (const cat of categories) {
            const logs = this.getLogs(cat, daysBack);
            if (logs.length === 0) {
                sections.push(`## ${cat.charAt(0).toUpperCase() + cat.slice(1)} Signals\n*No entries.*`);
                continue;
            }

            const entries = logs.map(l => {
                const date = new Date(l.created_at).toISOString().split('T')[0];
                const time = new Date(l.created_at).toLocaleTimeString('en-US', { hour12: false });
                const fields = Object.entries(l.payload)
                    .map(([k, v]) => `  - **${k}:** ${v}`)
                    .join('\n');
                return `### ${date} ${time}\n${fields}`;
            }).join('\n\n');

            sections.push(`## ${cat.charAt(0).toUpperCase() + cat.slice(1)} Signals (${logs.length})\n${entries}`);
        }

        return sections.join('\n\n');
    }

    formatApprovedLearnings(): string {
        const learnings = this.getApprovedLearnings();
        if (learnings.length === 0) return '*No approved learnings yet.*';

        return learnings.map(l =>
            `- **${l.title}** (relevance: ${(l.relevance_score * 100).toFixed(0)}%, activated: ${l.activation_count}x)\n  ${l.content}`
        ).join('\n');
    }
}
