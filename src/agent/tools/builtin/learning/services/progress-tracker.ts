/**
 * Progress Tracker Service
 *
 * Provides real-time progress updates and typing indicators during long-running operations.
 * Designed for learning path generation and other multi-step processes.
 */

import { logger } from '../../../../../utils/logger.js';
import { PROGRESS_TRACKER } from '../utils/constants.js';

export interface ProgressConfig {
    sessionKey: string;
    channelId: string;
    sendMessage?: (sessionKey: string, text: string) => Promise<void>;
    sendChatAction?: (sessionKey: string, action: string) => Promise<void>;
    editLastMessage?: (sessionKey: string, text: string) => Promise<void>;
}

export class ProgressTracker {
    private sessionKey: string;
    private channelId: string;
    private sendMessage?: (sessionKey: string, text: string) => Promise<void>;
    private sendChatAction?: (sessionKey: string, action: string) => Promise<void>;
    private editLastMessage?: (sessionKey: string, text: string) => Promise<void>;

    private typingInterval?: NodeJS.Timeout;
    private currentMessageId?: number;
    private progressMessageText?: string;
    private isDestroyed: boolean = false;

    constructor(config: ProgressConfig) {
        this.sessionKey = config.sessionKey;
        this.channelId = config.channelId;
        this.sendMessage = config.sendMessage;
        this.sendChatAction = config.sendChatAction;
        this.editLastMessage = config.editLastMessage;
    }

    /**
     * Start sending periodic typing indicators
     * Telegram typing indicators last 5 seconds, so we refresh based on PROGRESS_TRACKER.TYPING_REFRESH_INTERVAL_MS
     */
    startTyping(): void {
        if (this.isDestroyed) {
            logger.warn('Cannot start typing on destroyed ProgressTracker');
            return;
        }

        if (this.channelId === 'telegram' && this.sendChatAction) {
            this.sendChatAction(this.sessionKey, 'typing').catch(err => {
                logger.warn(`Failed to send typing indicator: ${err.message}`);
            });

            this.typingInterval = setInterval(() => {
                if (this.isDestroyed || !this.sendChatAction) {
                    this.stopTyping();
                    return;
                }
                this.sendChatAction!(this.sessionKey, 'typing').catch(() => {
                    // Silent fail
                });
            }, PROGRESS_TRACKER.TYPING_REFRESH_INTERVAL_MS);
        }
    }

    /**
     * Stop sending typing indicators
     */
    stopTyping(): void {
        if (this.typingInterval) {
            clearInterval(this.typingInterval);
            this.typingInterval = undefined;
        }
    }

    /**
     * Send or update a progress message
     * If a progress message already exists, it will be edited (if supported by channel)
     */
    async updateProgress(text: string): Promise<void> {
        if (this.isDestroyed) {
            logger.warn('Cannot update progress on destroyed ProgressTracker');
            return;
        }

        if (!this.sendMessage) {
            logger.warn('Cannot send progress update: sendMessage not configured');
            return;
        }

        try {
            if (this.progressMessageText && this.editLastMessage) {
                // Edit the existing progress message
                await this.editLastMessage(this.sessionKey, text);
                this.progressMessageText = text;
            } else {
                // Send a new progress message
                await this.sendMessage(this.sessionKey, text);
                this.progressMessageText = text;
            }
        } catch (err: any) {
            logger.warn(`Failed to update progress: ${err.message}`);
        }
    }

    /**
     * Convenience method to send a step update with emoji
     */
    async step(emoji: string, message: string): Promise<void> {
        await this.updateProgress(`${emoji} ${message}...`);
    }

    /**
     * Clean up resources and mark as destroyed
     * This ensures intervals are stopped and prevents further operations
     */
    cleanup(): void {
        this.stopTyping();
        this.isDestroyed = true;

        // Clear references to help with garbage collection
        this.sendMessage = undefined;
        this.sendChatAction = undefined;
        this.editLastMessage = undefined;
        this.progressMessageText = undefined;
    }

    /**
     * Check if the tracker has been destroyed
     */
    isActive(): boolean {
        return !this.isDestroyed;
    }
}

/**
 * Helper to create a progress tracker if channel supports it
 */
export function createProgressTracker(
    sessionKey: string,
    channelId: string,
    sendMessage?: (sessionKey: string, text: string) => Promise<void>,
    sendChatAction?: (sessionKey: string, action: string) => Promise<void>,
    editLastMessage?: (sessionKey: string, text: string) => Promise<void>
): ProgressTracker | null {
    // Only create tracker for channels that support progress updates
    if (channelId === 'telegram' || channelId === 'whatsapp') {
        return new ProgressTracker({
            sessionKey,
            channelId,
            sendMessage,
            sendChatAction,
            editLastMessage
        });
    }
    return null;
}
