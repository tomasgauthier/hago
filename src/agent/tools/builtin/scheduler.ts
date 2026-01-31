import { z } from 'zod';
import { ToolDefinition, ToolExecutionContext } from '../registry.js';
import { logger } from '../../../utils/logger.js';

/**
 * Tool for scheduling messages to be sent at a future time.
 * Uses the CronScheduler from the container to schedule one-time messages.
 */
export const scheduleMessageTool: ToolDefinition = {
    name: 'schedule_message',
    description: `Schedule a message to be sent to the user at a specified time in the future. 
Use this tool when the user asks you to remind them about something, send a message later, 
or schedule any kind of notification. 

Examples:
- "Remind me in 30 seconds that XYZ" → delaySeconds: 30
- "Send me a message in 5 minutes" → delaySeconds: 300
- "Remind me at 3pm to call John" → scheduledTime: "2024-01-15T15:00:00"

You can specify either:
- delaySeconds: Number of seconds from now (for relative scheduling like "in 30 seconds")
- scheduledTime: ISO 8601 datetime string (for absolute scheduling like "at 3pm")

If both are provided, delaySeconds takes precedence.`,
    parameters: z.object({
        message: z.string().describe('The message content to send when the scheduled time arrives'),
        delaySeconds: z.number().optional().describe('Number of seconds from now to send the message (e.g., 30 for "in 30 seconds")'),
        scheduledTime: z.string().optional().describe('ISO 8601 datetime for when to send the message (e.g., "2024-01-15T15:00:00")'),
    }),
    execute: async ({ message, delaySeconds, scheduledTime }, context?: ToolExecutionContext) => {
        if (!context?.sessionKey) {
            return 'Error: No session context available. Cannot schedule message.';
        }

        const scheduler = (global as any).container?.cron;
        if (!scheduler) {
            return 'Error: Scheduler not available.';
        }

        let targetTime: Date;

        if (delaySeconds !== undefined && delaySeconds > 0) {
            targetTime = new Date(Date.now() + delaySeconds * 1000);
        } else if (scheduledTime) {
            targetTime = new Date(scheduledTime);
            if (isNaN(targetTime.getTime())) {
                return `Error: Invalid scheduledTime format. Use ISO 8601 format (e.g., "2024-01-15T15:00:00")`;
            }
            if (targetTime.getTime() <= Date.now()) {
                return `Error: Scheduled time must be in the future.`;
            }
        } else {
            return 'Error: You must specify either delaySeconds or scheduledTime.';
        }

        try {
            const jobId = await scheduler.scheduleOneTime({
                sessionKey: context.sessionKey,
                message,
                runAt: targetTime,
            });

            const formattedTime = targetTime.toLocaleString('es-ES', {
                dateStyle: 'medium',
                timeStyle: 'medium',
            });

            logger.info(`Scheduled message for ${context.sessionKey} at ${formattedTime}: "${message.substring(0, 50)}..."`);

            return `✅ Message scheduled successfully!
📅 Will be sent at: ${formattedTime}
📝 Message: "${message}"
🆔 Job ID: ${jobId}`;
        } catch (err: any) {
            logger.error(`Failed to schedule message: ${err.message}`);
            return `Error scheduling message: ${err.message}`;
        }
    },
};

/**
 * Tool for listing scheduled messages for the current session.
 */
export const listScheduledMessagesTool: ToolDefinition = {
    name: 'list_scheduled_messages',
    description: 'List all pending scheduled messages for the current user/session. Shows upcoming reminders and notifications.',
    parameters: z.object({}),
    execute: async (_args, context?: ToolExecutionContext) => {
        if (!context?.sessionKey) {
            return 'Error: No session context available.';
        }

        const scheduler = (global as any).container?.cron;
        if (!scheduler) {
            return 'Error: Scheduler not available.';
        }

        try {
            const jobs = scheduler.getScheduledJobs(context.sessionKey);

            if (jobs.length === 0) {
                return 'No scheduled messages pending.';
            }

            const lines = jobs.map((job: any, i: number) => {
                const runAt = new Date(job.runAt).toLocaleString('es-ES', {
                    dateStyle: 'medium',
                    timeStyle: 'medium',
                });
                return `${i + 1}. [${job.id}] At ${runAt}: "${job.message}"`;
            });

            return `📋 Scheduled messages:\n${lines.join('\n')}`;
        } catch (err: any) {
            return `Error listing scheduled messages: ${err.message}`;
        }
    },
};

/**
 * Tool for canceling a scheduled message.
 */
export const cancelScheduledMessageTool: ToolDefinition = {
    name: 'cancel_scheduled_message',
    description: 'Cancel a previously scheduled message by its job ID. Use list_scheduled_messages first to get the job IDs.',
    parameters: z.object({
        jobId: z.string().describe('The ID of the scheduled job to cancel'),
    }),
    execute: async ({ jobId }, context?: ToolExecutionContext) => {
        if (!context?.sessionKey) {
            return 'Error: No session context available.';
        }

        const scheduler = (global as any).container?.cron;
        if (!scheduler) {
            return 'Error: Scheduler not available.';
        }

        try {
            const cancelled = scheduler.cancelJob(jobId, context.sessionKey);

            if (cancelled) {
                return `✅ Scheduled message ${jobId} has been cancelled.`;
            } else {
                return `❌ Could not find scheduled message with ID ${jobId} for your session.`;
            }
        } catch (err: any) {
            return `Error cancelling scheduled message: ${err.message}`;
        }
    },
};
