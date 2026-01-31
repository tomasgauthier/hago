/**
 * Audit log — persists security-relevant events to SQLite
 */

import type Database from 'better-sqlite3';
import { logger } from './logger.js';

export type AuditAction =
  | 'shell_execute'
  | 'config_update'
  | 'config_restore'
  | 'file_delete'
  | 'file_write'
  | 'auth_failure'
  | 'privileged_tool';

export interface AuditEntry {
  action: AuditAction;
  detail: string;
  sessionKey?: string;
  ip?: string;
}

export class AuditLog {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        detail TEXT NOT NULL,
        session_key TEXT,
        ip TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    `);
    logger.info('Audit log table initialized');
  }

  log(entry: AuditEntry): void {
    try {
      this.db.prepare(
        'INSERT INTO audit_log (action, detail, session_key, ip, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(entry.action, entry.detail, entry.sessionKey || null, entry.ip || null, Date.now());

      logger.info({ action: entry.action, detail: entry.detail.slice(0, 200) }, 'Audit event');
    } catch (err: any) {
      logger.error({ error: err }, 'Failed to write audit log');
    }
  }

  getRecent(limit: number = 50): any[] {
    return this.db.prepare(
      'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?'
    ).all(limit);
  }

  getByAction(action: AuditAction, limit: number = 50): any[] {
    return this.db.prepare(
      'SELECT * FROM audit_log WHERE action = ? ORDER BY created_at DESC LIMIT ?'
    ).all(action, limit);
  }
}
