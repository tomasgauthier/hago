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

export interface MindAction {
    id: number;
    tool_name: string;
    summary: string;
    args_snapshot: string;
    session_key: string;
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

            CREATE TABLE IF NOT EXISTS mind_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tool_name TEXT NOT NULL,
                summary TEXT NOT NULL,
                args_snapshot TEXT NOT NULL DEFAULT '{}',
                session_key TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_mind_log_category ON mind_log(category);
            CREATE INDEX IF NOT EXISTS idx_mind_log_created ON mind_log(created_at);
            CREATE INDEX IF NOT EXISTS idx_mind_learnings_approved ON mind_learnings(approved);
            CREATE INDEX IF NOT EXISTS idx_mind_actions_created ON mind_actions(created_at);
            CREATE INDEX IF NOT EXISTS idx_mind_actions_session ON mind_actions(session_key);
        `);

        // Migration: add session_key column for multi-user mind separation
        try {
            this.db.exec(`ALTER TABLE mind_log ADD COLUMN session_key TEXT NOT NULL DEFAULT ''`);
            this.db.exec(`CREATE INDEX IF NOT EXISTS idx_mind_log_session ON mind_log(session_key)`);
            logger.info('[MindStore] Migrated: added session_key column to mind_log');
        } catch {
            // Column already exists — ignore
        }

        // Migration: add rejected_titles for dream rejection memory
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS mind_rejected_learnings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                rejected_at INTEGER NOT NULL
            );
        `);

        logger.info('[MindStore] Initialized SQLite tables');
    }

    // ── Log operations ───────────────────────────────────────────────

    addLog(category: MindLogCategory, payload: Record<string, unknown>, sessionKey?: string): number {
        const now = Date.now();
        const result = this.db.prepare(
            'INSERT INTO mind_log (category, payload, created_at, session_key) VALUES (?, ?, ?, ?)'
        ).run(category, JSON.stringify(payload), now, sessionKey || '');
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

    // ── Action memory ─────────────────────────────────────────────────

    /**
     * Log a tool execution so the bot remembers what it did.
     * Only logs "significant" actions (not internal tools like get_usage_costs).
     */
    logAction(toolName: string, args: Record<string, unknown>, sessionKey: string = ''): number {
        const summary = buildActionSummary(toolName, args);
        if (!summary) return -1; // Skip trivial actions

        const now = Date.now();
        const result = this.db.prepare(
            'INSERT INTO mind_actions (tool_name, summary, args_snapshot, session_key, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(toolName, summary, JSON.stringify(args), sessionKey, now);
        logger.debug(`[MindStore] Logged action: ${summary}`);
        return result.lastInsertRowid as number;
    }

    /** Get recent actions, optionally filtered by session */
    getRecentActions(sinceDaysAgo: number = 7, sessionKey?: string): MindAction[] {
        const since = Date.now() - (sinceDaysAgo * 24 * 60 * 60 * 1000);
        if (sessionKey) {
            return this.db.prepare(
                'SELECT * FROM mind_actions WHERE created_at >= ? AND session_key = ? ORDER BY created_at DESC LIMIT 100'
            ).all(since, sessionKey) as MindAction[];
        }
        return this.db.prepare(
            'SELECT * FROM mind_actions WHERE created_at >= ? ORDER BY created_at DESC LIMIT 100'
        ).all(since) as MindAction[];
    }

    /** Format recent actions for injection into context */
    formatRecentActions(sessionKey?: string, limit: number = 20): string {
        const actions = this.getRecentActions(7, sessionKey).slice(0, limit);
        if (actions.length === 0) return '';

        const lines = actions.map(a => {
            const date = new Date(a.created_at).toISOString().replace('T', ' ').slice(0, 16);
            return `- [${date}] ${a.summary}`;
        });
        return `## Recent Actions (what I did)\n${lines.join('\n')}`;
    }

    /** Format actions for dream phase analysis */
    formatActionsForDream(daysBack: number = 7): string {
        const actions = this.getRecentActions(daysBack);
        if (actions.length === 0) return '## Actions\n*No actions recorded.*';

        // Group by tool for analysis
        const byTool: Record<string, number> = {};
        for (const a of actions) {
            byTool[a.tool_name] = (byTool[a.tool_name] || 0) + 1;
        }

        const toolSummary = Object.entries(byTool)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => `  - **${name}**: ${count}x`)
            .join('\n');

        const recentList = actions.slice(0, 30).map(a => {
            const date = new Date(a.created_at).toISOString().replace('T', ' ').slice(0, 16);
            return `  - [${date}] ${a.summary}`;
        }).join('\n');

        return `## Actions (${actions.length} total)\n### Tool Usage\n${toolSummary}\n### Recent\n${recentList}`;
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
        // Save to rejection memory before deleting — prevents re-proposal in future dreams
        const learning = this.db.prepare('SELECT title, content FROM mind_learnings WHERE id = ?').get(id) as any;
        if (learning) {
            this.db.prepare(
                'INSERT INTO mind_rejected_learnings (title, content, rejected_at) VALUES (?, ?, ?)'
            ).run(learning.title, learning.content, Date.now());
        }
        this.db.prepare('DELETE FROM mind_learnings WHERE id = ?').run(id);
    }

    /** Get previously rejected learning titles to avoid re-proposal */
    getRejectedTitles(): string[] {
        const rows = this.db.prepare(
            'SELECT title FROM mind_rejected_learnings ORDER BY rejected_at DESC LIMIT 100'
        ).all() as any[];
        return rows.map(r => r.title);
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

        // Include rejected learning titles so the LLM avoids re-proposing them
        const rejected = this.getRejectedTitles();
        if (rejected.length > 0) {
            sections.push(`## Previously Rejected Learnings (DO NOT re-propose)\n${rejected.map(t => `- ${t}`).join('\n')}`);
        }

        return sections.join('\n\n');
    }

    formatLogsForDreamFull(daysBack: number = 7): string {
        const logs = this.formatLogsForDream(daysBack);
        const actions = this.formatActionsForDream(daysBack);
        return `${logs}\n\n${actions}`;
    }

    formatApprovedLearnings(): string {
        const learnings = this.getApprovedLearnings();
        if (learnings.length === 0) return '*No approved learnings yet.*';

        return learnings.map(l =>
            `- **${l.title}** (relevance: ${(l.relevance_score * 100).toFixed(0)}%, activated: ${l.activation_count}x)\n  ${l.content}`
        ).join('\n');
    }
}

// ── Action summary builder ──────────────────────────────────────────

/** Tools that are already tracked elsewhere or are purely internal */
const TRIVIAL_TOOLS = new Set([
    'get_usage_costs', 'estimate_message_cost',
    'log_stress', 'confess_uncertainty', 'log_ethical_refusal', 'log_guidance',
    'save_learning', 'approve_learning', 'reject_learning',
    'dream',
]);

/**
 * Build a human-readable summary of a tool execution.
 * Returns null for trivial/meta tools that don't need action tracking.
 */
function buildActionSummary(toolName: string, args: Record<string, unknown>): string | null {
    if (TRIVIAL_TOOLS.has(toolName)) return null;

    const a = args;
    switch (toolName) {
        // File operations
        case 'fs_write_file':
        case 'write_file':
            return `Wrote file: ${a.path || a.filePath || 'unknown'}`;
        case 'fs_read_file':
        case 'read_file':
            return `Read file: ${a.path || a.filePath || 'unknown'}`;
        case 'fs_list_directory':
            return `Listed directory: ${a.path || '.'}`;
        case 'fs_create_directory':
            return `Created directory: ${a.path || 'unknown'}`;
        case 'fs_delete_file':
            return `Deleted file: ${a.path || 'unknown'}`;

        // Shell
        case 'shell_execute':
            return `Ran command: ${truncate(String(a.command || ''), 80)}`;

        // Obsidian
        case 'obsidian_create':
            return `Created note: "${a.title || a.name || 'untitled'}"`;
        case 'obsidian_search':
            return `Searched notes for: "${a.query || ''}"`;
        case 'obsidian_read':
            return `Read note: "${a.path || a.title || ''}"`;
        case 'obsidian_update_tags':
            return `Updated tags on: "${a.path || ''}"`;

        // Web
        case 'web_search':
            return `Web search: "${truncate(String(a.query || ''), 60)}"`;
        case 'browser_navigate':
            return `Browsed: ${truncate(String(a.url || ''), 80)}`;
        case 'browser_get_content':
            return `Extracted page content`;
        case 'browser_click':
            return `Clicked element: ${a.selector || 'unknown'}`;
        case 'browser_fill':
            return `Filled form field: ${a.selector || 'unknown'}`;

        // Memory
        case 'memory_store':
            return `Stored memory: "${truncate(String(a.text || a.content || ''), 60)}"`;
        case 'memory_query':
            return `Queried memory: "${truncate(String(a.query || ''), 60)}"`;

        // Scheduling
        case 'schedule_message':
            return `Scheduled reminder: "${truncate(String(a.task || a.message || ''), 60)}"`;

        // Journal & finance
        case 'save_journal_entry':
            return `Journal entry (${a.category || 'general'}): "${truncate(String(a.content || ''), 50)}"`;
        case 'log_transaction':
            return `Logged ${a.type || 'transaction'}: ${a.amount} ${a.currency || ''} — ${a.description || ''}`;

        // Telegram
        case 'telegram_create_poll':
            return `Created poll: "${a.question || ''}"`;

        // Config
        case 'config_read':
            return `Read config`;
        case 'config_update':
            return `Updated config: ${a.path || 'unknown'}`;
        case 'config_restore':
            return `Restored config from backup`;

        default:
            // Unknown tool — log with generic summary
            return `Used tool: ${toolName}`;
    }
}

function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) + '...' : s;
}
