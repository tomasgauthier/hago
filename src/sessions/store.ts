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

// Learning System Types
export interface LearningPath {
    id: number;
    sessionKey: string;
    title: string;
    topic: string;
    difficulty: 'beginner' | 'intermediate' | 'advanced';
    language: string;
    totalDurationMin: number;
    researchData?: string;
    status: 'generating' | 'ready' | 'in_progress' | 'completed';
    createdAt: number;
    completedAt?: number;
}

export interface LearningModule {
    id: number;
    learningPathId: number;
    moduleNumber: number;
    title: string;
    content: string;
    estimatedTimeMin: number;
    quizQuestions?: string;
    completed: boolean;
    completedAt?: number;
    timeSpentSec: number;
}

export interface UserLearningProfile {
    id: number;
    sessionKey: string;
    preferredDifficulty?: string;
    preferredLanguage?: string;
    avgModuleTimeSec?: number;
    completionRate?: number;
    quizAvgScore?: number;
    learningStyle?: string;
    teachingPace?: string;
    preferredAnalogyDomains?: string;
    lastUpdated?: number;
}

export interface UserProgress {
    id: number;
    sessionKey: string;
    moduleId: number;
    status: 'not_started' | 'in_progress' | 'completed';
    startedAt?: number;
    completedAt?: number;
    timeSpentSec: number;
    difficultyRating?: number;
}

export interface QuizAttempt {
    id: number;
    sessionKey: string;
    moduleId: number;
    questionIndex: number;
    userAnswer: string;
    isCorrect: boolean;
    attemptedAt: number;
}

export interface LearningSession {
    id: number;
    sessionKey: string;
    learningPathId: number;
    startedAt: number;
    endedAt?: number;
    modulesCompleted: number;
    pomodoroCompleted: boolean;
}

export class SessionStore {
    public db: Database.Database;

    constructor(dataDir: string) {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const dbPath = path.join(dataDir, 'hago.db');
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

      -- Learning System Tables
      CREATE TABLE IF NOT EXISTS learning_paths (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        title TEXT NOT NULL,
        topic TEXT NOT NULL,
        difficulty TEXT CHECK(difficulty IN ('beginner', 'intermediate', 'advanced')),
        language TEXT DEFAULT 'en',
        total_duration_min INTEGER DEFAULT 25,
        research_data TEXT,
        status TEXT CHECK(status IN ('generating', 'ready', 'in_progress', 'completed')) DEFAULT 'ready',
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (session_key) REFERENCES sessions(key) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS learning_modules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        learning_path_id INTEGER NOT NULL,
        module_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        estimated_time_min INTEGER DEFAULT 5,
        quiz_questions TEXT,
        completed BOOLEAN DEFAULT 0,
        completed_at INTEGER,
        time_spent_sec INTEGER DEFAULT 0,
        FOREIGN KEY (learning_path_id) REFERENCES learning_paths(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_learning_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT UNIQUE NOT NULL,
        preferred_difficulty TEXT,
        preferred_language TEXT,
        avg_module_time_sec INTEGER,
        completion_rate REAL,
        quiz_avg_score REAL,
        learning_style TEXT,
        teaching_pace TEXT,
        preferred_analogy_domains TEXT,
        last_updated INTEGER,
        FOREIGN KEY (session_key) REFERENCES sessions(key) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        module_id INTEGER NOT NULL,
        status TEXT CHECK(status IN ('not_started', 'in_progress', 'completed')) DEFAULT 'not_started',
        started_at INTEGER,
        completed_at INTEGER,
        time_spent_sec INTEGER DEFAULT 0,
        difficulty_rating INTEGER,
        FOREIGN KEY (module_id) REFERENCES learning_modules(id) ON DELETE CASCADE,
        UNIQUE(session_key, module_id)
      );

      CREATE TABLE IF NOT EXISTS quiz_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        module_id INTEGER NOT NULL,
        question_index INTEGER NOT NULL,
        user_answer TEXT NOT NULL,
        is_correct BOOLEAN NOT NULL,
        attempted_at INTEGER NOT NULL,
        FOREIGN KEY (module_id) REFERENCES learning_modules(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS poll_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id TEXT UNIQUE NOT NULL,
        session_key TEXT NOT NULL,
        module_id INTEGER NOT NULL,
        question_index INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (module_id) REFERENCES learning_modules(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_poll_metadata_poll_id ON poll_metadata(poll_id);

      CREATE TABLE IF NOT EXISTS learning_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        learning_path_id INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        modules_completed INTEGER DEFAULT 0,
        pomodoro_completed BOOLEAN DEFAULT 0,
        FOREIGN KEY (learning_path_id) REFERENCES learning_paths(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_learning_paths_session ON learning_paths(session_key);
      CREATE INDEX IF NOT EXISTS idx_modules_path ON learning_modules(learning_path_id);
      CREATE INDEX IF NOT EXISTS idx_progress_session ON user_progress(session_key);
      CREATE INDEX IF NOT EXISTS idx_quiz_module ON quiz_attempts(module_id);
      CREATE INDEX IF NOT EXISTS idx_learning_sessions_path ON learning_sessions(learning_path_id);
    `);

        // Migration: Add tool_call_id if it doesn't exist
        try {
            this.db.exec('ALTER TABLE messages ADD COLUMN tool_call_id TEXT;');
        } catch (err) { }

        logger.info('Database initialized');
    }

    recordUsage(sessionId: number, providerId: string, model: string, inputTokens: number, outputTokens: number) {
        const { inputRate, outputRate } = getCostRates(model);
        const cost = (inputTokens * inputRate) + (outputTokens * outputRate);
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

    // ==========================================
    // Learning System Repository Methods
    // ==========================================

    /**
     * Get all quiz attempts for a session and module
     */
    getQuizAttempts(sessionKey: string, moduleId: number): QuizAttempt[] {
        const rows = this.db.prepare(
            'SELECT * FROM quiz_attempts WHERE session_key = ? AND module_id = ?'
        ).all(sessionKey, moduleId) as any[];

        return rows.map(row => ({
            id: row.id,
            sessionKey: row.session_key,
            moduleId: row.module_id,
            questionIndex: row.question_index,
            userAnswer: row.user_answer,
            isCorrect: Boolean(row.is_correct),
            attemptedAt: row.attempted_at
        }));
    }

    /**
     * Get all quiz attempts for a session (across all modules)
     */
    getAllQuizAttempts(sessionKey: string): QuizAttempt[] {
        const rows = this.db.prepare(
            'SELECT * FROM quiz_attempts WHERE session_key = ?'
        ).all(sessionKey) as any[];

        return rows.map(row => ({
            id: row.id,
            sessionKey: row.session_key,
            moduleId: row.module_id,
            questionIndex: row.question_index,
            userAnswer: row.user_answer,
            isCorrect: Boolean(row.is_correct),
            attemptedAt: row.attempted_at
        }));
    }

    /**
     * Add a quiz attempt
     */
    addQuizAttempt(attempt: Omit<QuizAttempt, 'id'>): number {
        const result = this.db.prepare(`
            INSERT INTO quiz_attempts (
                session_key, module_id, question_index, user_answer, is_correct, attempted_at
            ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            attempt.sessionKey,
            attempt.moduleId,
            attempt.questionIndex,
            attempt.userAnswer,
            attempt.isCorrect ? 1 : 0,
            attempt.attemptedAt
        );
        return result.lastInsertRowid as number;
    }

    /**
     * Get distinct answered question indices for a module
     */
    getAnsweredQuestionIndices(sessionKey: string, moduleId: number): number[] {
        const rows = this.db.prepare(
            'SELECT DISTINCT question_index FROM quiz_attempts WHERE session_key = ? AND module_id = ?'
        ).all(sessionKey, moduleId) as any[];

        return rows.map(row => row.question_index);
    }

    /**
     * Get a learning module by ID
     */
    getLearningModule(moduleId: number): LearningModule | undefined {
        const row = this.db.prepare(
            'SELECT * FROM learning_modules WHERE id = ?'
        ).get(moduleId) as any;

        if (!row) return undefined;

        return {
            id: row.id,
            learningPathId: row.learning_path_id,
            moduleNumber: row.module_number,
            title: row.title,
            content: row.content,
            estimatedTimeMin: row.estimated_time_min,
            quizQuestions: row.quiz_questions || undefined,
            completed: Boolean(row.completed),
            completedAt: row.completed_at || undefined,
            timeSpentSec: row.time_spent_sec || 0
        };
    }

    /**
     * Get a learning path by ID
     */
    getLearningPath(pathId: number): LearningPath | undefined {
        const row = this.db.prepare(
            'SELECT * FROM learning_paths WHERE id = ?'
        ).get(pathId) as any;

        if (!row) return undefined;

        return {
            id: row.id,
            sessionKey: row.session_key,
            title: row.title,
            topic: row.topic,
            difficulty: row.difficulty,
            language: row.language,
            totalDurationMin: row.total_duration_min,
            researchData: row.research_data || undefined,
            status: row.status,
            createdAt: row.created_at,
            completedAt: row.completed_at || undefined
        };
    }

    /**
     * Get user learning profile
     */
    getLearningProfile(sessionKey: string): UserLearningProfile | undefined {
        const row = this.db.prepare(
            'SELECT * FROM user_learning_profiles WHERE session_key = ?'
        ).get(sessionKey) as any;

        if (!row) return undefined;

        return {
            id: row.id,
            sessionKey: row.session_key,
            preferredDifficulty: row.preferred_difficulty || undefined,
            preferredLanguage: row.preferred_language || undefined,
            avgModuleTimeSec: row.avg_module_time_sec || undefined,
            completionRate: row.completion_rate || undefined,
            quizAvgScore: row.quiz_avg_score || undefined,
            learningStyle: row.learning_style || undefined,
            teachingPace: row.teaching_pace || undefined,
            preferredAnalogyDomains: row.preferred_analogy_domains || undefined,
            lastUpdated: row.last_updated || undefined
        };
    }

    /**
     * Update or create user learning profile
     */
    upsertLearningProfile(sessionKey: string, updates: Partial<Omit<UserLearningProfile, 'id' | 'sessionKey'>>): void {
        const existing = this.getLearningProfile(sessionKey);
        const now = Date.now();

        if (existing) {
            const setClauses: string[] = [];
            const values: any[] = [];

            if (updates.preferredDifficulty !== undefined) {
                setClauses.push('preferred_difficulty = ?');
                values.push(updates.preferredDifficulty);
            }
            if (updates.preferredLanguage !== undefined) {
                setClauses.push('preferred_language = ?');
                values.push(updates.preferredLanguage);
            }
            if (updates.avgModuleTimeSec !== undefined) {
                setClauses.push('avg_module_time_sec = ?');
                values.push(updates.avgModuleTimeSec);
            }
            if (updates.completionRate !== undefined) {
                setClauses.push('completion_rate = ?');
                values.push(updates.completionRate);
            }
            if (updates.quizAvgScore !== undefined) {
                setClauses.push('quiz_avg_score = ?');
                values.push(updates.quizAvgScore);
            }
            if (updates.learningStyle !== undefined) {
                setClauses.push('learning_style = ?');
                values.push(updates.learningStyle);
            }
            if (updates.teachingPace !== undefined) {
                setClauses.push('teaching_pace = ?');
                values.push(updates.teachingPace);
            }
            if (updates.preferredAnalogyDomains !== undefined) {
                setClauses.push('preferred_analogy_domains = ?');
                values.push(updates.preferredAnalogyDomains);
            }

            setClauses.push('last_updated = ?');
            values.push(now);
            values.push(sessionKey);

            if (setClauses.length > 1) {
                this.db.prepare(
                    `UPDATE user_learning_profiles SET ${setClauses.join(', ')} WHERE session_key = ?`
                ).run(...values);
            }
        } else {
            this.db.prepare(`
                INSERT INTO user_learning_profiles (
                    session_key, preferred_difficulty, preferred_language, avg_module_time_sec,
                    completion_rate, quiz_avg_score, learning_style, teaching_pace,
                    preferred_analogy_domains, last_updated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                sessionKey,
                updates.preferredDifficulty || null,
                updates.preferredLanguage || null,
                updates.avgModuleTimeSec || null,
                updates.completionRate || null,
                updates.quizAvgScore || null,
                updates.learningStyle || null,
                updates.teachingPace || null,
                updates.preferredAnalogyDomains || null,
                now
            );
        }
    }
}

/** Per-token cost rates (USD) for known models. Rates are per token (not per 1M). */
function getCostRates(model: string): { inputRate: number; outputRate: number } {
    const m = model.toLowerCase();

    // Anthropic Claude
    if (m.includes('claude-3-5-sonnet') || m.includes('claude-3.5-sonnet'))
        return { inputRate: 3.0 / 1e6, outputRate: 15.0 / 1e6 };
    if (m.includes('claude-3-5-haiku') || m.includes('claude-3.5-haiku'))
        return { inputRate: 0.8 / 1e6, outputRate: 4.0 / 1e6 };
    if (m.includes('claude-3-opus') || m.includes('claude-3.0-opus'))
        return { inputRate: 15.0 / 1e6, outputRate: 75.0 / 1e6 };
    if (m.includes('claude'))
        return { inputRate: 3.0 / 1e6, outputRate: 15.0 / 1e6 };

    // Google Gemini
    if (m.includes('gemini-2.0-flash') || m.includes('gemini-2.5-flash'))
        return { inputRate: 0.075 / 1e6, outputRate: 0.30 / 1e6 };
    if (m.includes('gemini-1.5-flash') || m.includes('gemini-flash'))
        return { inputRate: 0.075 / 1e6, outputRate: 0.30 / 1e6 };
    if (m.includes('gemini-1.5-pro') || m.includes('gemini-pro'))
        return { inputRate: 1.25 / 1e6, outputRate: 5.0 / 1e6 };

    // OpenAI
    if (m.includes('gpt-4o-mini'))
        return { inputRate: 0.15 / 1e6, outputRate: 0.60 / 1e6 };
    if (m.includes('gpt-4o'))
        return { inputRate: 2.5 / 1e6, outputRate: 10.0 / 1e6 };
    if (m.includes('gpt-4-turbo') || m.includes('gpt-4'))
        return { inputRate: 10.0 / 1e6, outputRate: 30.0 / 1e6 };
    if (m.includes('gpt-3.5'))
        return { inputRate: 0.5 / 1e6, outputRate: 1.5 / 1e6 };

    // Ollama / local — free
    if (m.includes('llama') || m.includes('mistral') || m.includes('phi') || m.includes('qwen'))
        return { inputRate: 0, outputRate: 0 };

    // Unknown — conservative Gemini Flash rate as fallback
    return { inputRate: 0.075 / 1e6, outputRate: 0.30 / 1e6 };
}
