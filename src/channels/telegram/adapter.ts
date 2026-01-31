import { Bot } from 'grammy';
import { Channel, InboundMessage, OutboundMessage } from '../types.js';
import { logger } from '../../utils/logger.js';

export class TelegramChannel implements Channel {
    public id = 'telegram';
    private bot: Bot;
    private handler?: (msg: InboundMessage) => void;
    private authorizedUsers: number[];

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

    async start() {
        this.bot.on('message:text', async (ctx) => {
            const fromId = ctx.from?.id;
            if (this.authorizedUsers.length > 0 && fromId && !this.authorizedUsers.includes(fromId)) {
                logger.warn(`Unauthorized access attempt from Telegram ID: ${fromId}`);
                await ctx.reply(`Sorry, you are not authorized to use this bot. Your ID is: ${fromId}. Please add it to the configuration.`);
                return;
            }

            if (this.handler) {
                this.handler({
                    id: ctx.message.message_id.toString(),
                    sessionKey: `telegram:${ctx.chat.id}`,
                    text: ctx.message.text,
                    channelId: this.id,
                    timestamp: ctx.message.date,
                });
            }
        });

        this.bot.start({
            onStart: (botInfo) => {
                logger.info(`Telegram bot started as @${botInfo.username}`);
            },
        });
    }

    async stop() {
        await this.bot.stop();
        logger.info('Telegram bot stopped');
    }

    async sendMessage(msg: OutboundMessage) {
        const chatId = msg.sessionKey.split(':')[1];
        try {
            await this.bot.api.sendMessage(chatId, msg.text, { parse_mode: 'Markdown' });
        } catch (err: any) {
            // Fallback to plain text if markdown parsing fails (e.g. unclosed tags)
            logger.warn(`Markdown parsing failed for Telegram, falling back to plain text: ${err.message}`);
            await this.bot.api.sendMessage(chatId, msg.text);
        }
    }
}
