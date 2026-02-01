import { Bot, InlineKeyboard } from 'grammy';
import { Channel, InboundMessage, OutboundMessage } from '../types.js';
import { logger } from '../../utils/logger.js';

// Extended types for rich Telegram features
export interface TelegramOutboundMessage extends OutboundMessage {
    type?: 'text' | 'poll' | 'keyboard' | 'reaction';
    keyboard?: InlineKeyboardButton[][];
    pollOptions?: string[];
    pollType?: 'regular' | 'quiz';
    correctOptionId?: number;
    reactionEmoji?: string;
    replyToMessageId?: number;
    editMessageId?: number;
}

export interface InlineKeyboardButton {
    text: string;
    callback_data?: string;
    url?: string;
    switch_inline_query?: string;
}

export interface TelegramInboundMessage extends InboundMessage {
    type: 'text' | 'callback_query' | 'poll_answer' | 'reaction' | 'voice' | 'photo' | 'document';
    callbackData?: string;
    pollAnswers?: number[];
    reactions?: string[];
    mediaType?: string;
    fileId?: string;
    caption?: string;
    voiceDuration?: number;
}

export class EnhancedTelegramChannel implements Channel {
    public id = 'telegram';
    private bot: Bot;
    private handler?: (msg: InboundMessage) => void;
    private authorizedUsers: number[];
    private messageHistory: Map<string, number> = new Map(); // sessionKey -> last message ID

    constructor(token: string, authorizedUsers: number[] = []) {
        this.bot = new Bot(token);
        this.authorizedUsers = authorizedUsers;
    }

    onMessage(handler: (msg: InboundMessage) => void) {
        this.handler = handler;
    }

    updateConfig(config: any) {
        if (config.authorizedUsers) {
            this.authorizedUsers = config.authorizedUsers;
            logger.info(`Telegram authorized users updated: ${this.authorizedUsers.length} users`);
        }
    }

    private isAuthorized(userId?: number): boolean {
        if (this.authorizedUsers.length === 0) return true;
        return userId ? this.authorizedUsers.includes(userId) : false;
    }

    async start() {
        // Handle text messages
        this.bot.on('message:text', async (ctx) => {
            if (!this.isAuthorized(ctx.from?.id)) {
                logger.warn(`Unauthorized text message from Telegram ID: ${ctx.from?.id}`);
                await ctx.reply(`Sorry, you are not authorized. Your ID is: ${ctx.from?.id}`);
                return;
            }

            if (this.handler) {
                const sessionKey = `telegram:${ctx.chat.id}`;
                this.messageHistory.set(sessionKey, ctx.message.message_id);
                
                this.handler({
                    id: ctx.message.message_id.toString(),
                    sessionKey,
                    text: ctx.message.text,
                    channelId: this.id,
                    timestamp: ctx.message.date,
                    type: 'text'
                });
            }
        });

        // Handle callback queries (inline keyboard button presses)
        this.bot.on('callback_query:data', async (ctx) => {
            if (!this.isAuthorized(ctx.from?.id)) {
                logger.warn(`Unauthorized callback query from Telegram ID: ${ctx.from?.id}`);
                await ctx.answerCallbackQuery('Not authorized');
                return;
            }

            await ctx.answerCallbackQuery(); // Acknowledge the button press

            if (this.handler) {
                this.handler({
                    id: `cb_${ctx.callbackQuery.id}`,
                    sessionKey: `telegram:${ctx.chat?.id}`,
                    text: `Button pressed: ${ctx.callbackQuery.data}`,
                    channelId: this.id,
                    timestamp: Math.floor(Date.now() / 1000),
                    type: 'callback_query',
                    callbackData: ctx.callbackQuery.data
                });
            }
        });

        // Handle poll answers
        this.bot.on('poll_answer', async (ctx) => {
            if (!this.isAuthorized(ctx.pollAnswer.user?.id)) {
                logger.warn(`Unauthorized poll answer from Telegram ID: ${ctx.pollAnswer.user?.id}`);
                return;
            }

            if (this.handler && ctx.pollAnswer.user) {
                const answerText = `Poll answer: options ${ctx.pollAnswer.option_ids.join(', ')}`;
                
                this.handler({
                    id: `poll_${ctx.pollAnswer.poll_id}`,
                    sessionKey: `telegram:${ctx.pollAnswer.user.id}`, // Use user ID for poll answers
                    text: answerText,
                    channelId: this.id,
                    timestamp: Math.floor(Date.now() / 1000),
                    type: 'poll_answer',
                    pollAnswers: ctx.pollAnswer.option_ids
                });
            }
        });

        // Handle message reactions (if available - newer Telegram feature)
        this.bot.on('message_reaction', async (ctx) => {
            if (!this.isAuthorized(ctx.messageReaction.user?.id)) {
                return;
            }

            if (this.handler) {
                const reactions = ctx.messageReaction.new_reaction.map((r: any) => r.emoji || r.type).filter(Boolean);
                const reactionText = `Reacted with: ${reactions.join(' ')}`;
                
                this.handler({
                    id: `reaction_${ctx.messageReaction.message_id}`,
                    sessionKey: `telegram:${ctx.messageReaction.chat.id}`,
                    text: reactionText,
                    channelId: this.id,
                    timestamp: Math.floor(Date.now() / 1000),
                    type: 'reaction',
                    reactions: reactions
                });
            }
        });

        // Handle voice messages
        this.bot.on('message:voice', async (ctx) => {
            if (!this.isAuthorized(ctx.from?.id)) {
                logger.warn(`Unauthorized voice message from Telegram ID: ${ctx.from?.id}`);
                return;
            }

            if (this.handler) {
                this.handler({
                    id: ctx.message.message_id.toString(),
                    sessionKey: `telegram:${ctx.chat.id}`,
                    text: '[Voice message received]',
                    channelId: this.id,
                    timestamp: ctx.message.date,
                    type: 'voice',
                    fileId: ctx.message.voice.file_id,
                    voiceDuration: ctx.message.voice.duration
                });
            }
        });

        // Handle photo messages
        this.bot.on('message:photo', async (ctx) => {
            if (!this.isAuthorized(ctx.from?.id)) {
                logger.warn(`Unauthorized photo from Telegram ID: ${ctx.from?.id}`);
                return;
            }

            if (this.handler) {
                const caption = ctx.message.caption || '[Photo received]';
                
                this.handler({
                    id: ctx.message.message_id.toString(),
                    sessionKey: `telegram:${ctx.chat.id}`,
                    text: caption,
                    channelId: this.id,
                    timestamp: ctx.message.date,
                    type: 'photo',
                    fileId: ctx.message.photo[ctx.message.photo.length - 1].file_id,
                    caption: ctx.message.caption
                });
            }
        });

        // Handle document messages
        this.bot.on('message:document', async (ctx) => {
            if (!this.isAuthorized(ctx.from?.id)) {
                logger.warn(`Unauthorized document from Telegram ID: ${ctx.from?.id}`);
                return;
            }

            if (this.handler) {
                const caption = ctx.message.caption || `[Document: ${ctx.message.document.file_name}]`;
                
                this.handler({
                    id: ctx.message.message_id.toString(),
                    sessionKey: `telegram:${ctx.chat.id}`,
                    text: caption,
                    channelId: this.id,
                    timestamp: ctx.message.date,
                    type: 'document',
                    fileId: ctx.message.document.file_id,
                    caption: ctx.message.caption
                });
            }
        });

        this.bot.start({
            onStart: (botInfo) => {
                logger.info(`Enhanced Telegram bot started as @${botInfo.username}`);
            },
        });
    }

    async stop() {
        await this.bot.stop();
        logger.info('Enhanced Telegram bot stopped');
    }

    async sendMessage(msg: OutboundMessage | TelegramOutboundMessage) {
        const chatId = msg.sessionKey.split(':')[1];
        const telegramMsg = msg as TelegramOutboundMessage;

        try {
            switch (telegramMsg.type) {
                case 'poll':
                    if (telegramMsg.pollOptions && telegramMsg.pollOptions.length >= 2) {
                        await this.bot.api.sendPoll(
                            chatId,
                            telegramMsg.text,
                            telegramMsg.pollOptions,
                            {
                                is_anonymous: false,
                                type: telegramMsg.pollType || 'regular',
                                correct_option_id: telegramMsg.correctOptionId,
                                allows_multiple_answers: telegramMsg.pollType === 'regular'
                            }
                        );
                    }
                    break;

                case 'keyboard':
                    if (telegramMsg.keyboard) {
                        const keyboard = new InlineKeyboard();
                        telegramMsg.keyboard.forEach(row => {
                            row.forEach((btn, index) => {
                                if (index === 0) keyboard.text(btn.text, btn.callback_data || btn.text);
                                else keyboard.text(btn.text, btn.callback_data || btn.text);
                            });
                            keyboard.row();
                        });

                        await this.bot.api.sendMessage(chatId, telegramMsg.text, {
                            reply_markup: keyboard,
                            parse_mode: 'Markdown'
                        });
                    }
                    break;

                case 'reaction':
                    if (telegramMsg.reactionEmoji && telegramMsg.replyToMessageId) {
                        await this.bot.api.setMessageReaction(
                            chatId,
                            telegramMsg.replyToMessageId,
                            [{ type: 'emoji', emoji: telegramMsg.reactionEmoji as any }]
                        );
                    }
                    break;

                default:
                    // Regular text message
                    let sentMessage;
                    if (telegramMsg.editMessageId) {
                        // Edit existing message
                        sentMessage = await this.bot.api.editMessageText(
                            chatId,
                            telegramMsg.editMessageId,
                            telegramMsg.text,
                            { parse_mode: 'Markdown' }
                        );
                    } else {
                        // Send new message
                        sentMessage = await this.bot.api.sendMessage(chatId, telegramMsg.text, {
                            parse_mode: 'Markdown',
                            reply_to_message_id: telegramMsg.replyToMessageId
                        });
                    }

                    // Store message ID for potential future editing/reactions
                    if (sentMessage && typeof sentMessage === 'object' && 'message_id' in sentMessage) {
                        this.messageHistory.set(msg.sessionKey, (sentMessage as any).message_id);
                    }
                    break;
            }
        } catch (err: any) {
            if (err.message.includes('parse entities')) {
                // Fallback to plain text if markdown parsing fails
                logger.warn(`Markdown parsing failed for Telegram, falling back to plain text: ${err.message}`);
                await this.bot.api.sendMessage(chatId, telegramMsg.text);
            } else {
                logger.error(`Telegram send error: ${err.message}`);
                throw err;
            }
        }
    }

    // Helper method to get the last message ID for a session (for reactions/editing)
    getLastMessageId(sessionKey: string): number | undefined {
        return this.messageHistory.get(sessionKey);
    }

    /**
     * Stream a response to Telegram by sending a placeholder and editing it with chunks.
     * Updates are throttled to avoid Telegram rate limits (~30 edits/min per chat).
     */
    async streamResponse(sessionKey: string, textStream: AsyncIterable<string>): Promise<void> {
        const chatId = sessionKey.split(':')[1];
        let fullText = '';
        let messageId: number | null = null;
        let lastEditTime = 0;
        const MIN_EDIT_INTERVAL_MS = 1500; // Throttle edits to avoid rate limits

        for await (const chunk of textStream) {
            fullText += chunk;

            if (!messageId) {
                // Send initial message with first chunk
                try {
                    const sent = await this.bot.api.sendMessage(chatId, fullText + ' ▍');
                    messageId = sent.message_id;
                    lastEditTime = Date.now();
                } catch (err: any) {
                    logger.error(`Telegram stream start error: ${err.message}`);
                    return;
                }
                continue;
            }

            // Throttle edits
            const now = Date.now();
            if (now - lastEditTime < MIN_EDIT_INTERVAL_MS) continue;

            try {
                await this.bot.api.editMessageText(chatId, messageId, fullText + ' ▍');
                lastEditTime = now;
            } catch (err: any) {
                // Ignore edit errors (message not modified, etc.)
                if (!err.message.includes('message is not modified')) {
                    logger.warn(`Telegram stream edit error: ${err.message}`);
                }
            }
        }

        // Final edit — remove cursor indicator
        if (messageId && fullText) {
            try {
                await this.bot.api.editMessageText(chatId, messageId, fullText, { parse_mode: 'Markdown' });
            } catch {
                // Fallback without markdown
                try { await this.bot.api.editMessageText(chatId, messageId, fullText); } catch { /* ignore */ }
            }
            this.messageHistory.set(sessionKey, messageId);
        }
    }
}