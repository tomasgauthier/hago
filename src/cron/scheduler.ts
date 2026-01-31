import { Cron } from 'croner';
import { ChannelManager } from '../channels/manager.js';
import { logger } from '../utils/logger.js';
import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

export interface CronJob {
    id: string;
    pattern: string;
    task: string;
    sessionKey: string;
}

export interface ScheduledMessage {
    id: string;
    sessionKey: string;
    message: string;
    runAt: Date;
    createdAt: Date;
}

interface StoredScheduledJob {
    id: string;
    session_key: string;
    message: string;
    run_at: number;
    created_at: number;
}

export class CronScheduler {
    private fixedJobs: Map<string, Cron> = new Map();
    private scheduledJobs: Map<string, NodeJS.Timeout> = new Map();
    private channelManager: ChannelManager | null = null;
    private db: Database.Database;

    constructor(config: { dataDir: string }) {
        // Initialize SQLite database for persistence
        const dbPath = path.join(config.dataDir, 'scheduler.db');
        this.db = new Database(dbPath);
        this.initDatabase();
    }

    private initDatabase() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS scheduled_messages (
                id TEXT PRIMARY KEY,
                session_key TEXT NOT NULL,
                message TEXT NOT NULL,
                run_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_scheduled_session ON scheduled_messages(session_key);
            CREATE INDEX IF NOT EXISTS idx_scheduled_run_at ON scheduled_messages(run_at);
        `);
    }

    /**
     * Set the channel manager for sending messages.
     * Called after container initialization.
     */
    setChannelManager(channelManager: ChannelManager) {
        this.channelManager = channelManager;
        // Restore any persisted scheduled jobs on startup
        this.restoreScheduledJobs();
    }

    /**
     * Schedule a fixed cron job (pattern-based, recurring).
     */
    scheduleFixed(job: CronJob) {
        const cron = new Cron(job.pattern, async () => {
            logger.info(`Running fixed cron job ${job.id}: ${job.task}`);
            try {
                await this.sendMessage(job.sessionKey, `⏰ Scheduled task: ${job.task}`);
            } catch (err: any) {
                logger.error(`Fixed cron job ${job.id} failed: ${err.message}`);
            }
        });

        this.fixedJobs.set(job.id, cron);
        logger.info(`Scheduled fixed job ${job.id} with pattern ${job.pattern}`);
    }

    /**
     * Schedule a one-time message to be sent at a specific time.
     */
    async scheduleOneTime(params: {
        sessionKey: string;
        message: string;
        runAt: Date;
    }): Promise<string> {
        const id = `msg_${crypto.randomBytes(8).toString('hex')}`;
        const now = Date.now();
        const runAtMs = params.runAt.getTime();

        if (runAtMs <= now) {
            throw new Error('Scheduled time must be in the future');
        }

        // Persist to database
        const stmt = this.db.prepare(`
            INSERT INTO scheduled_messages (id, session_key, message, run_at, created_at)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(id, params.sessionKey, params.message, runAtMs, now);

        // Set up in-memory timer
        this.setupTimer(id, params.sessionKey, params.message, runAtMs);

        logger.info(`Scheduled one-time message ${id} for ${params.sessionKey} at ${params.runAt.toISOString()}`);

        return id;
    }

    private setupTimer(id: string, sessionKey: string, message: string, runAtMs: number) {
        const delay = runAtMs - Date.now();

        // Cap at max setTimeout value (~24.8 days) and re-schedule if needed
        const MAX_TIMEOUT = 2147483647;
        const actualDelay = Math.min(delay, MAX_TIMEOUT);

        const timer = setTimeout(async () => {
            if (delay > MAX_TIMEOUT) {
                // Re-schedule for the remaining time
                this.setupTimer(id, sessionKey, message, runAtMs);
                return;
            }

            try {
                logger.info(`Executing scheduled message ${id}`);
                await this.sendMessage(sessionKey, `⏰ Reminder: ${message}`);

                // Remove from database after successful execution
                this.removeFromDatabase(id);
                this.scheduledJobs.delete(id);
            } catch (err: any) {
                logger.error(`Failed to send scheduled message ${id}: ${err.message}`);
                // Keep in database for retry on next restart
            }
        }, actualDelay);

        this.scheduledJobs.set(id, timer);
    }

    private async sendMessage(sessionKey: string, text: string) {
        if (!this.channelManager) {
            logger.warn(`Cannot send scheduled message: ChannelManager not set`);
            return;
        }

        // Extract channel type from session key (e.g., "telegram:123456" → "telegram")
        const channelId = sessionKey.split(':')[0];

        // Access the channel through the channel manager
        const channel = (this.channelManager as any).channels?.get(channelId);
        if (!channel) {
            logger.error(`Channel ${channelId} not found for scheduled message`);
            return;
        }

        await channel.sendMessage({ sessionKey, text });
        logger.info(`Sent scheduled message to ${sessionKey}`);
    }

    /**
     * Restore scheduled jobs from database on startup.
     */
    private restoreScheduledJobs() {
        const stmt = this.db.prepare(`
            SELECT id, session_key, message, run_at FROM scheduled_messages
            WHERE run_at > ?
        `);
        const jobs = stmt.all(Date.now()) as StoredScheduledJob[];

        for (const job of jobs) {
            this.setupTimer(job.id, job.session_key, job.message, job.run_at);
            logger.info(`Restored scheduled job ${job.id} for ${job.session_key}`);
        }

        // Clean up expired jobs
        const cleanupStmt = this.db.prepare(`DELETE FROM scheduled_messages WHERE run_at <= ?`);
        const result = cleanupStmt.run(Date.now());
        if (result.changes > 0) {
            logger.info(`Cleaned up ${result.changes} expired scheduled messages`);
        }

        logger.info(`Restored ${jobs.length} scheduled messages from database`);
    }

    private removeFromDatabase(id: string) {
        const stmt = this.db.prepare(`DELETE FROM scheduled_messages WHERE id = ?`);
        stmt.run(id);
    }

    /**
     * Get all scheduled jobs for a specific session.
     */
    getScheduledJobs(sessionKey: string): ScheduledMessage[] {
        const stmt = this.db.prepare(`
            SELECT id, session_key, message, run_at, created_at 
            FROM scheduled_messages 
            WHERE session_key = ? AND run_at > ?
            ORDER BY run_at ASC
        `);
        const rows = stmt.all(sessionKey, Date.now()) as StoredScheduledJob[];

        return rows.map(row => ({
            id: row.id,
            sessionKey: row.session_key,
            message: row.message,
            runAt: new Date(row.run_at),
            createdAt: new Date(row.created_at),
        }));
    }

    /**
     * Cancel a scheduled job by ID.
     */
    cancelJob(jobId: string, sessionKey: string): boolean {
        // Verify the job belongs to the session
        const stmt = this.db.prepare(`
            SELECT id FROM scheduled_messages WHERE id = ? AND session_key = ?
        `);
        const row = stmt.get(jobId, sessionKey);

        if (!row) {
            return false;
        }

        // Cancel the timer
        const timer = this.scheduledJobs.get(jobId);
        if (timer) {
            clearTimeout(timer);
            this.scheduledJobs.delete(jobId);
        }

        // Remove from database
        this.removeFromDatabase(jobId);
        logger.info(`Cancelled scheduled job ${jobId}`);

        return true;
    }

    /**
     * Stop all jobs (both fixed and one-time).
     */
    stopAll() {
        // Stop fixed cron jobs
        for (const cron of this.fixedJobs.values()) {
            cron.stop();
        }
        this.fixedJobs.clear();

        // Clear scheduled timers (but keep in database for restoration)
        for (const timer of this.scheduledJobs.values()) {
            clearTimeout(timer);
        }
        this.scheduledJobs.clear();

        logger.info('All cron jobs stopped');
    }

    /**
     * Close the database connection.
     */
    close() {
        this.stopAll();
        this.db.close();
    }
}
