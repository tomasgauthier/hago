import { Channel, InboundMessage, OutboundMessage } from './types.js';
import { AgentRunner } from '../agent/runner.js';
import { AgentRouter } from '../agent/router.js';
import { logger } from '../utils/logger.js';
import { setUserName } from '../agent/identity.js';
import type { SessionStore } from '../sessions/store.js';
import { createThread } from '../utils/message-chunker.js';

/** Keywords that trigger individual processing even when stale */
const ACTION_KEYWORDS = /\b(pendiente|diario|gasto|thought|idea)\b/i;

/** Messages older than this (in seconds) are considered stale / offline */
const STALE_THRESHOLD_SECONDS = 120; // 2 minutes

/** How long to wait for more stale messages before flushing the batch (ms) */
const BATCH_FLUSH_DELAY_MS = 3000;

interface PendingBatch {
    messages: InboundMessage[];
    timer: ReturnType<typeof setTimeout>;
}

export class ChannelManager {
    private channels: Map<string, Channel> = new Map();
    private agent: AgentRunner;
    private router: AgentRouter | null;
    private sessions: SessionStore | null;
    private processingQueues: Map<string, Promise<void>> = new Map();
    private pendingBatches: Map<string, PendingBatch> = new Map();
    private startedAt: number = 0;
    private dailyCostCeiling: number;

    constructor(config: { agent: AgentRunner; router?: AgentRouter; sessions?: SessionStore }) {
        this.agent = config.agent;
        this.router = config.router || null;
        this.sessions = config.sessions || null;
        this.dailyCostCeiling = parseFloat(process.env.DAILY_COST_CEILING || '5.00');
    }

    registerChannel(channel: Channel) {
        this.channels.set(channel.id, channel);
        channel.onMessage((msg) => this.handleInbound(msg));
        logger.info(`Channel registered: ${channel.id}`);
    }

    getChannel(channelId: string): Channel | undefined {
        return this.channels.get(channelId);
    }

    updateChannelConfig(channelId: string, config: any) {
        const channel = this.channels.get(channelId);
        if (channel && channel.updateConfig) {
            channel.updateConfig(config);
            logger.info(`Updated config for channel: ${channelId}`);
        }
    }

    private isStale(msg: InboundMessage): boolean {
        if (!msg.timestamp) return false;
        const nowSeconds = Math.floor(Date.now() / 1000);
        return (nowSeconds - msg.timestamp) > STALE_THRESHOLD_SECONDS;
    }

    private async handleInbound(msg: InboundMessage) {
        const channel = this.channels.get(msg.channelId);
        if (!channel) return;

        // Cache user name for personalization in system prompt
        if (msg.userName) {
            setUserName(msg.sessionKey, msg.userName);
        }

        const sendReply = async (fullText: string) => {
            if (fullText) {
                // Automatically chunk long messages for messaging platforms
                const chunks = createThread(fullText, { maxLength: 3800 });

                for (const chunk of chunks) {
                    await channel.sendMessage({ sessionKey: msg.sessionKey, text: chunk });

                    // Small delay between messages to avoid rate limits
                    if (chunks.length > 1) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
            }
        };

        // If the message is stale but contains an action keyword, process it individually
        if (this.isStale(msg) && ACTION_KEYWORDS.test(msg.text)) {
            logger.info(`Stale action message, processing individually: "${msg.text.substring(0, 40)}..."`);
            await this.runQueued(msg.sessionKey, msg.text, sendReply);
            return;
        }

        // If the message is stale, add to batch
        if (this.isStale(msg)) {
            this.addToBatch(msg, channel);
            return;
        }

        // Real-time message — flush any pending batch first, then process normally
        const pending = this.pendingBatches.get(msg.sessionKey);
        if (pending) {
            clearTimeout(pending.timer);
            this.pendingBatches.delete(msg.sessionKey);
            await this.flushBatch(pending.messages, channel);
        }

        await this.runQueued(msg.sessionKey, msg.text, sendReply);
    }

    private addToBatch(msg: InboundMessage, channel: Channel) {
        const key = msg.sessionKey;
        const existing = this.pendingBatches.get(key);

        if (existing) {
            clearTimeout(existing.timer);
            existing.messages.push(msg);
        } else {
            this.pendingBatches.set(key, {
                messages: [msg],
                timer: null as any,
            });
        }

        const batch = this.pendingBatches.get(key)!;
        batch.timer = setTimeout(async () => {
            this.pendingBatches.delete(key);
            await this.flushBatch(batch.messages, channel);
        }, BATCH_FLUSH_DELAY_MS);
    }

    private async flushBatch(messages: InboundMessage[], channel: Channel) {
        if (messages.length === 0) return;

        const sessionKey = messages[0].sessionKey;

        if (messages.length === 1) {
            // Single stale message — just process it normally
            logger.info(`Flushing 1 offline message for ${sessionKey}`);
            await this.runQueued(sessionKey, messages[0].text, async (fullText) => {
                if (fullText) {
                    const chunks = createThread(fullText, { maxLength: 3800 });
                    for (const chunk of chunks) {
                        await channel.sendMessage({ sessionKey, text: chunk });
                        if (chunks.length > 1) {
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    }
                }
            });
            return;
        }

        // Multiple stale messages — batch them into a single compound message
        const lines = messages.map((m, i) => {
            const ago = m.timestamp
                ? this.formatTimeAgo(m.timestamp)
                : 'unknown time';
            return `${i + 1}. (${ago}): ${m.text}`;
        });

        const batchedText = `[You were offline. Here are the messages I sent while you were away — please address them together]\n${lines.join('\n')}`;

        logger.info(`Flushing ${messages.length} offline messages as batch for ${sessionKey}`);

        await this.runQueued(sessionKey, batchedText, async (fullText) => {
            if (fullText) {
                const chunks = createThread(fullText, { maxLength: 3800 });
                for (const chunk of chunks) {
                    await channel.sendMessage({ sessionKey, text: chunk });
                    if (chunks.length > 1) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
            }
        });
    }

    private formatTimeAgo(timestamp: number): string {
        const diffSeconds = Math.floor(Date.now() / 1000) - timestamp;
        if (diffSeconds < 60) return `${diffSeconds}s ago`;
        if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
        if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
        return `${Math.floor(diffSeconds / 86400)}d ago`;
    }

    public async runQueued(
        sessionKey: string,
        text: string,
        onComplete: (fullText: string) => Promise<void>,
        onChunk?: (chunk: string) => void
    ): Promise<void> {
        // Queue messages per session to prevent concurrent LLM calls for the same session
        const existingQueue = this.processingQueues.get(sessionKey) || Promise.resolve();

        const nextInQueue = existingQueue.then(async () => {
            await this._processMessage(sessionKey, text, onComplete, onChunk);
        }).catch(err => {
            logger.error(`Error in queue for ${sessionKey}: ${err.message}`);
        }).finally(() => {
            // Only remove if we are still the last one in the queue
            if (this.processingQueues.get(sessionKey) === nextInQueue) {
                this.processingQueues.delete(sessionKey);
            }
        });

        this.processingQueues.set(sessionKey, nextInQueue);
        return nextInQueue;
    }

    private async _processMessage(
        sessionKey: string,
        text: string,
        onComplete: (fullText: string) => Promise<void>,
        onChunk?: (chunk: string) => void
    ) {
        logger.info(`Processing message for ${sessionKey}: ${text.substring(0, 50)}...`);

        // Enforce daily cost ceiling across all channels
        if (this.sessions) {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const row = this.sessions.db.prepare(
                'SELECT COALESCE(SUM(cost), 0) as dailyCost FROM usage WHERE created_at >= ?'
            ).get(startOfDay.getTime()) as any;
            if (row.dailyCost >= this.dailyCostCeiling) {
                logger.warn(`Daily cost ceiling reached ($${row.dailyCost.toFixed(4)} >= $${this.dailyCostCeiling.toFixed(2)}), dropping message`);
                await onComplete(`⚠️ Daily cost ceiling of $${this.dailyCostCeiling.toFixed(2)} reached. I'll be back tomorrow, or adjust DAILY_COST_CEILING in .env.`);
                return;
            }
        }

        try {
            const providerId = this.router?.resolve(text);
            const responseStream = this.agent.run({
                sessionKey,
                text,
                providerId,
            });

            let fullText = '';
            for await (const event of responseStream) {
                if (event.type === 'chunk' && event.content) {
                    fullText += event.content;
                    if (onChunk) onChunk(event.content);
                } else if (event.type === 'error') {
                    logger.error(`Generation error for ${sessionKey}: ${event.error}`);
                    if (onChunk) onChunk(`\nError: ${event.error}`);
                    return;
                }
            }

            await onComplete(fullText);
        } catch (err: any) {
            logger.error(`Error in _processMessage for ${sessionKey}: ${err.message}`);
        }
    }

    async start() {
        this.startedAt = Math.floor(Date.now() / 1000);
        for (const channel of this.channels.values()) {
            await channel.start();
        }
    }

    async stop() {
        // Process any pending batches before shutdown (don't discard — they're already ACK'd by Telegram)
        for (const [key, batch] of this.pendingBatches) {
            clearTimeout(batch.timer);
            this.pendingBatches.delete(key);
            if (batch.messages.length > 0) {
                const channelId = batch.messages[0].channelId;
                const channel = this.channels.get(channelId);
                if (channel) {
                    logger.info(`Flushing ${batch.messages.length} pending messages for ${key} before shutdown`);
                    try {
                        await this.flushBatch(batch.messages, channel);
                    } catch (err: any) {
                        logger.error(`Failed to flush batch for ${key} on shutdown: ${err.message}`);
                    }
                }
            }
        }

        // Wait for any in-flight processing to finish
        const pending = Array.from(this.processingQueues.values());
        if (pending.length > 0) {
            logger.info(`Waiting for ${pending.length} in-flight message(s) to finish...`);
            await Promise.allSettled(pending);
        }

        for (const channel of this.channels.values()) {
            await channel.stop();
        }
    }
}
