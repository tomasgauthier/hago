import pino from 'pino';

/**
 * List of prefixes for sensitive environment variables to be redacted in logs.
 */
const SENSITIVE_KEYS = [
    'GOOGLE_API_KEY',
    'TELEGRAM_TOKEN',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY'
];

/**
 * Redaction layer for pino logger.
 * It searches for sensitive keys in log objects and masks their values.
 */
export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    redact: {
        paths: [
            ...SENSITIVE_KEYS,
            '*.token',
            '*.password',
            '*.apiKey',
            'msg.token',
            'msg.apiKey'
        ],
        censor: '[REDACTED]'
    },
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'SYS:standard',
        },
    },
});
