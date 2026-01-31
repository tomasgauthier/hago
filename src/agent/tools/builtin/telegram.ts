import { z } from 'zod';
import { ToolDefinition, ToolExecutionContext } from '../registry.js';
import { logger } from '../../../utils/logger.js';

// Define the types locally to avoid import issues
interface TelegramOutboundMessage {
    sessionKey: string;
    text: string;
    type?: 'text' | 'poll' | 'keyboard' | 'reaction';
    keyboard?: InlineKeyboardButton[][];
    pollOptions?: string[];
    pollType?: 'regular' | 'quiz';
    correctOptionId?: number;
    reactionEmoji?: string;
    replyToMessageId?: number;
    editMessageId?: number;
}

interface InlineKeyboardButton {
    text: string;
    callback_data?: string;
    url?: string;
    switch_inline_query?: string;
}

/**
 * Tool for creating polls in Telegram
 */
export const telegramCreatePollTool: ToolDefinition = {
    name: 'telegram_create_poll',
    description: `Create a poll in Telegram. Use this when the user asks about creating a survey, 
poll, or wants to gather opinions from multiple choice options.

Examples:
- "Create a poll asking what should we have for lunch with options pizza, burgers, salad"
- "Make a quiz about capitals with the question and 4 options"`,
    parameters: z.object({
        question: z.string().describe('The poll question'),
        options: z.array(z.string()).describe('Array of poll options (2-10 options)'),
        type: z.enum(['regular', 'quiz']).optional().describe('Poll type: regular (multiple answers) or quiz (single correct answer)'),
        correctOptionIndex: z.number().optional().describe('Index of correct answer (0-based) for quiz type'),
    }),
    execute: async ({ question, options, type = 'regular', correctOptionIndex }, context?: ToolExecutionContext) => {
        if (!context?.sessionKey) {
            return 'Error: No session context available.';
        }

        if (!context.sessionKey.startsWith('telegram:')) {
            return 'Error: Polls are only supported in Telegram.';
        }

        if (options.length < 2 || options.length > 10) {
            return 'Error: Polls must have between 2 and 10 options.';
        }

        if (type === 'quiz' && (correctOptionIndex === undefined || correctOptionIndex < 0 || correctOptionIndex >= options.length)) {
            return 'Error: Quiz polls require a valid correctOptionIndex (0-based).';
        }

        const container = (global as any).container;
        if (!container?.channels) {
            return 'Error: Channel system not available.';
        }

        try {
            const telegramChannel = (container.channels as any).channels?.get('telegram');
            if (!telegramChannel) {
                return 'Error: Telegram channel not available.';
            }

            const pollMessage: TelegramOutboundMessage = {
                sessionKey: context.sessionKey,
                text: question,
                type: 'poll',
                pollOptions: options,
                pollType: type,
                correctOptionId: type === 'quiz' ? correctOptionIndex : undefined,
            };

            await telegramChannel.sendMessage(pollMessage);

            const pollType = type === 'quiz' ? 'Quiz' : 'Poll';
            return `✅ ${pollType} created successfully!
📊 Question: "${question}"
📋 Options: ${options.map((opt: string, i: number) => `${i + 1}. ${opt}`).join(', ')}`;
        } catch (err: any) {
            logger.error(`Failed to create poll: ${err.message}`);
            return `Error creating poll: ${err.message}`;
        }
    },
};

/**
 * Tool for creating inline keyboards in Telegram
 */
export const telegramCreateKeyboardTool: ToolDefinition = {
    name: 'telegram_create_keyboard',
    description: `Create an inline keyboard with buttons in Telegram. Use this for quick actions, 
menu selection, or interactive responses.

Examples:
- "Show options to choose between Option A and Option B"
- "Create a menu with buttons for Settings, Help, About"`,
    parameters: z.object({
        message: z.string().describe('The message text to show with the keyboard'),
        buttons: z.array(z.array(z.object({
            text: z.string().describe('Button text'),
            action: z.string().describe('Action identifier when button is pressed'),
        }))).describe('2D array of buttons (rows and columns)'),
    }),
    execute: async ({ message, buttons }, context?: ToolExecutionContext) => {
        if (!context?.sessionKey) {
            return 'Error: No session context available.';
        }

        if (!context.sessionKey.startsWith('telegram:')) {
            return 'Error: Inline keyboards are only supported in Telegram.';
        }

        if (buttons.length === 0) {
            return 'Error: At least one button is required.';
        }

        const container = (global as any).container;
        if (!container?.channels) {
            return 'Error: Channel system not available.';
        }

        try {
            const telegramChannel = (container.channels as any).channels?.get('telegram');
            if (!telegramChannel) {
                return 'Error: Telegram channel not available.';
            }

            const keyboard = buttons.map((row: any[]) => 
                row.map((btn: any) => ({
                    text: btn.text,
                    callback_data: btn.action
                }))
            );

            const keyboardMessage: TelegramOutboundMessage = {
                sessionKey: context.sessionKey,
                text: message,
                type: 'keyboard',
                keyboard: keyboard,
            };

            await telegramChannel.sendMessage(keyboardMessage);

            const buttonCount = buttons.flat().length;
            return `✅ Inline keyboard created successfully!
💬 Message: "${message}"
🔘 Buttons: ${buttonCount} buttons in ${buttons.length} row(s)`;
        } catch (err: any) {
            logger.error(`Failed to create keyboard: ${err.message}`);
            return `Error creating keyboard: ${err.message}`;
        }
    },
};

/**
 * Tool for reacting to messages in Telegram
 */
export const telegramReactToMessageTool: ToolDefinition = {
    name: 'telegram_react_to_message',
    description: `Add an emoji reaction to the last message in Telegram. Use this to express 
sentiment or acknowledgment.

Examples:
- "React with a heart emoji" → emoji: "❤️"
- "Add a thumbs up reaction" → emoji: "👍"
- "React with fire" → emoji: "🔥"`,
    parameters: z.object({
        emoji: z.string().describe('Emoji to react with (e.g., "❤️", "👍", "🔥", "😍", "👏")'),
    }),
    execute: async ({ emoji }, context?: ToolExecutionContext) => {
        if (!context?.sessionKey) {
            return 'Error: No session context available.';
        }

        if (!context.sessionKey.startsWith('telegram:')) {
            return 'Error: Message reactions are only supported in Telegram.';
        }

        const container = (global as any).container;
        if (!container?.channels) {
            return 'Error: Channel system not available.';
        }

        try {
            const telegramChannel = (container.channels as any).channels?.get('telegram');
            if (!telegramChannel) {
                return 'Error: Telegram channel not available.';
            }

            // Get the last message ID for this session
            const lastMessageId = telegramChannel.getLastMessageId?.(context.sessionKey);
            if (!lastMessageId) {
                return 'Error: No recent message found to react to.';
            }

            const reactionMessage: TelegramOutboundMessage = {
                sessionKey: context.sessionKey,
                text: '',
                type: 'reaction',
                reactionEmoji: emoji,
                replyToMessageId: lastMessageId,
            };

            await telegramChannel.sendMessage(reactionMessage);

            return `✅ Reacted with ${emoji} to your message!`;
        } catch (err: any) {
            logger.error(`Failed to add reaction: ${err.message}`);
            return `Error adding reaction: ${err.message}`;
        }
    },
};

/**
 * Tool for editing the last sent message
 */
export const telegramEditLastMessageTool: ToolDefinition = {
    name: 'telegram_edit_last_message',
    description: `Edit the last message sent by the bot in Telegram. Use this to correct or update 
information in the previous message.

Examples:
- "Edit the last message to say 'Hello World'"
- "Update my previous response with the correct information"`,
    parameters: z.object({
        newText: z.string().describe('The new text content for the message'),
    }),
    execute: async ({ newText }, context?: ToolExecutionContext) => {
        if (!context?.sessionKey) {
            return 'Error: No session context available.';
        }

        if (!context.sessionKey.startsWith('telegram:')) {
            return 'Error: Message editing is only supported in Telegram.';
        }

        const container = (global as any).container;
        if (!container?.channels) {
            return 'Error: Channel system not available.';
        }

        try {
            const telegramChannel = (container.channels as any).channels?.get('telegram');
            if (!telegramChannel) {
                return 'Error: Telegram channel not available.';
            }

            // Get the last message ID for this session
            const lastMessageId = telegramChannel.getLastMessageId?.(context.sessionKey);
            if (!lastMessageId) {
                return 'Error: No recent message found to edit.';
            }

            const editMessage: TelegramOutboundMessage = {
                sessionKey: context.sessionKey,
                text: newText,
                editMessageId: lastMessageId,
            };

            await telegramChannel.sendMessage(editMessage);

            return `✅ Message edited successfully!`;
        } catch (err: any) {
            logger.error(`Failed to edit message: ${err.message}`);
            return `Error editing message: ${err.message}`;
        }
    },
};

/**
 * Tool for getting information about received media
 */
export const telegramGetMediaInfoTool: ToolDefinition = {
    name: 'telegram_get_media_info',
    description: `Get information about media files (photos, documents, voice messages) received in Telegram. 
Use this to analyze or respond to media content.`,
    parameters: z.object({
        fileId: z.string().describe('The file ID of the media (from the message context)'),
    }),
    execute: async ({ fileId }, context?: ToolExecutionContext) => {
        if (!context?.sessionKey) {
            return 'Error: No session context available.';
        }

        if (!context.sessionKey.startsWith('telegram:')) {
            return 'Error: Media handling is only supported in Telegram.';
        }

        const container = (global as any).container;
        if (!container?.channels) {
            return 'Error: Channel system not available.';
        }

        try {
            const telegramChannel = (container.channels as any).channels?.get('telegram');
            if (!telegramChannel?.bot) {
                return 'Error: Telegram channel not available.';
            }

            const file = await telegramChannel.bot.api.getFile(fileId);
            
            return `📁 Media Information:
🆔 File ID: ${file.file_id}
📏 Size: ${file.file_size || 'Unknown'} bytes
📂 Path: ${file.file_path || 'N/A'}
🌐 Download URL: https://api.telegram.org/file/bot<TOKEN>/${file.file_path}`;
        } catch (err: any) {
            logger.error(`Failed to get media info: ${err.message}`);
            return `Error getting media info: ${err.message}`;
        }
    },
};