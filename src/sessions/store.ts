import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

export interface Session {
    id: number;
    key: string; // e.g., 'telegram:12345'
    providerId: string;
    model: string;
    createdAt: number;
    updatedAt: number;
}

export interface Message {
    id: number;
    sessionId: number;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    metadata?: any;
    toolCallId?: string;
    createdAt: number;
}

export class SessionStore {
    public db: Database.Database;

    constructor(dataDir: string) {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const dbPath = path.join(dataDir, 'tombot.db');
        this.db = new Database(dbPath);
        this.init();
    }

    private init() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        provider_id TEXT,
        model TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        role TEXT,
        content TEXT,
        metadata TEXT,
        tool_call_id TEXT,
        created_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(key);

      CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        provider_id TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cost REAL,
        created_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_usage_session ON usage(session_id);
    `);

        // Migration: Add tool_call_id if it doesn't exist
        try {
            this.db.exec('ALTER TABLE messages ADD COLUMN tool_call_id TEXT;');
        } catch (err) { }

        logger.info('Database initialized');
    }

    recordUsage(sessionId: number, providerId: string, model: string, inputTokens: number, outputTokens: number) {
        // Very simple cost calculation (e.g., Gemini 1.5 Flash $0.075 / 1M tokens)
        let rate = 0.000000075; // Per token (roughly $0.075 / 1M)
        if (model.includes('pro')) rate = 0.00000125; // ($1.25 / 1M)

        const cost = (inputTokens + outputTokens) * rate;
        const now = Date.now();

        this.db.prepare(
            'INSERT INTO usage (session_id, provider_id, model, input_tokens, output_tokens, cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(sessionId, providerId, model, inputTokens, outputTokens, cost, now);
    }

    getTotalCosts(): { totalCost: number, totalTokens: number } {
        const row = this.db.prepare('SELECT SUM(cost) as totalCost, SUM(input_tokens + output_tokens) as totalTokens FROM usage').get() as any;
        return {
            totalCost: row.totalCost || 0,
            totalTokens: row.totalTokens || 0
        };
    }

    getSessionCosts(sessionId: number): { totalCost: number, totalTokens: number, messageCount: number } {
        const row = this.db.prepare(
            'SELECT SUM(cost) as totalCost, SUM(input_tokens + output_tokens) as totalTokens, COUNT(*) as messageCount FROM usage WHERE session_id = ?'
        ).get(sessionId) as any;
        return {
            totalCost: row.totalCost || 0,
            totalTokens: row.totalTokens || 0,
            messageCount: row.messageCount || 0,
        };
    }

    getOrCreateSession(key: string, providerId: string, model: string): Session {
        const existing = this.db.prepare('SELECT * FROM sessions WHERE key = ?').get(key) as any;

        if (existing) {
            return {
                id: existing.id,
                key: existing.key,
                providerId: existing.provider_id,
                model: existing.model,
                createdAt: existing.created_at,
                updatedAt: existing.updated_at,
            };
        }

        const now = Date.now();
        const result = this.db.prepare(
            'INSERT INTO sessions (key, provider_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).run(key, providerId, model, now, now);

        return {
            id: result.lastInsertRowid as number,
            key,
            providerId,
            model,
            createdAt: now,
            updatedAt: now,
        };
    }

    getHistory(sessionId: number, limit: number = 20): Message[] {
        const rows = this.db.prepare(
            'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
        ).all(sessionId, limit) as any[];

        return rows.reverse().map(row => ({
            id: row.id,
            sessionId: row.session_id,
            role: row.role,
            content: row.content,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            toolCallId: row.tool_call_id || undefined,
            createdAt: row.created_at,
        }));
    }

    addMessage(sessionId: number, role: Message['role'], content: string, toolCallId?: string, metadata?: any) {
        const now = Date.now();
        this.db.transaction(() => {
            this.db.prepare(
                'INSERT INTO messages (session_id, role, content, metadata, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(sessionId, role, content, metadata ? JSON.stringify(metadata) : null, toolCallId || null, now);

            this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
        })();
    }

    close() {
        this.db.close();
    }
}
