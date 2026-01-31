/**
 * Approval queue for operations requiring user confirmation
 */

import { EventEmitter } from 'events';
import type { Logger } from 'pino';

export interface PendingOperation {
  id: string;
  sessionKey: string;
  operation: string;
  description: string;
  params: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
}

export type ApprovalResponse = {
  approved: boolean;
  reason?: string;
};

export class ApprovalQueue extends EventEmitter {
  private pending = new Map<string, PendingOperation>();
  private responses = new Map<string, ApprovalResponse>();
  private logger: Logger;

  constructor(logger: Logger) {
    super();
    this.logger = logger;

    // Clean up expired operations every minute
    setInterval(() => this.cleanupExpired(), 60000);
  }

  /**
   * Request approval for an operation
   * @param sessionKey The session requesting the operation
   * @param operation The operation name
   * @param description Human-readable description
   * @param params Operation parameters
   * @param timeoutMs How long to wait for approval (default: 5 minutes)
   * @returns Promise that resolves when user approves/denies or times out
   */
  async requestApproval(
    sessionKey: string,
    operation: string,
    description: string,
    params: Record<string, unknown>,
    timeoutMs = 300000 // 5 minutes
  ): Promise<ApprovalResponse> {
    const id = this.generateId();
    const createdAt = new Date();
    const expiresAt = new Date(Date.now() + timeoutMs);

    const pendingOp: PendingOperation = {
      id,
      sessionKey,
      operation,
      description,
      params,
      createdAt,
      expiresAt,
    };

    this.pending.set(id, pendingOp);

    this.logger.info({
      approvalId: id,
      sessionKey,
      operation,
      description,
      expiresAt,
    }, 'Approval requested');

    // Emit event so the channel can send a message to the user
    this.emit('approval-requested', pendingOp);

    // Wait for response or timeout
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        // Check if we got a response
        if (this.responses.has(id)) {
          const response = this.responses.get(id)!;
          this.responses.delete(id);
          this.pending.delete(id);
          clearInterval(checkInterval);
          resolve(response);
          return;
        }

        // Check if expired
        if (Date.now() >= expiresAt.getTime()) {
          this.pending.delete(id);
          clearInterval(checkInterval);
          this.logger.warn({ approvalId: id }, 'Approval request timed out');
          resolve({
            approved: false,
            reason: 'Approval request timed out',
          });
        }
      }, 1000);
    });
  }

  /**
   * Respond to an approval request
   */
  respondToApproval(id: string, approved: boolean, reason?: string): boolean {
    if (!this.pending.has(id)) {
      this.logger.warn({ approvalId: id }, 'Attempted to respond to unknown approval request');
      return false;
    }

    const operation = this.pending.get(id)!;
    this.responses.set(id, { approved, reason });

    this.logger.info({
      approvalId: id,
      approved,
      operation: operation.operation,
    }, 'Approval response received');

    return true;
  }

  /**
   * Get all pending approvals for a session
   */
  getPendingForSession(sessionKey: string): PendingOperation[] {
    return Array.from(this.pending.values()).filter(
      (op) => op.sessionKey === sessionKey
    );
  }

  /**
   * Get a pending operation by ID
   */
  getPending(id: string): PendingOperation | undefined {
    return this.pending.get(id);
  }

  /**
   * Cancel a pending approval request
   */
  cancelApproval(id: string): boolean {
    if (!this.pending.has(id)) {
      return false;
    }

    this.pending.delete(id);
    this.responses.set(id, {
      approved: false,
      reason: 'Cancelled by system',
    });

    this.logger.info({ approvalId: id }, 'Approval request cancelled');
    return true;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, op] of this.pending.entries()) {
      if (now >= op.expiresAt.getTime()) {
        this.pending.delete(id);
        this.responses.set(id, {
          approved: false,
          reason: 'Expired',
        });
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug({ count: cleaned }, 'Cleaned up expired approval requests');
    }
  }

  private generateId(): string {
    return `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
