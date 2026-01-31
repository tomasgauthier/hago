import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import { AppConfigSchema, type AppConfig } from './schema.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

export function loadConfig(configPath?: string): AppConfig {
    const actualPath = configPath || process.env.CONFIG_PATH || 'config.json5';

    if (!fs.existsSync(actualPath)) {
        // If no config file, try to build from environment variables for basic setup
        logger.warn(`Config file not found at ${actualPath}. Attempting to load from env.`);
        return loadFromEnv();
    }

    try {
        const raw = fs.readFileSync(actualPath, 'utf8');
        const parsed = JSON5.parse(raw);

        // Inject secrets from environment variables — never store secrets in config.json5
        injectEnvSecrets(parsed);

        const validated = AppConfigSchema.parse(parsed);
        return validated;
    } catch (err: any) {
        throw new AppError(`Failed to load config: ${err.message}`, 'CONFIG_ERROR', 500, err);
    }
}

export function saveConfig(config: AppConfig, configPath?: string) {
    const actualPath = configPath || process.env.CONFIG_PATH || 'config.json5';

    try {
        // Create backup
        if (fs.existsSync(actualPath)) {
            fs.copyFileSync(actualPath, `${actualPath}.bak`);
        }

        // Validate before saving
        const validated = AppConfigSchema.parse(config);
        const raw = JSON5.stringify(validated, { space: 4 });
        fs.writeFileSync(actualPath, raw, 'utf8');
        logger.info(`Config saved successfully to ${actualPath}`);
    } catch (err: any) {
        throw new AppError(`Failed to save config: ${err.message}`, 'CONFIG_ERROR', 500, err);
    }
}

function injectEnvSecrets(config: any): void {
    // Provider API keys from env
    for (const provider of config.providers || []) {
        if (provider.type === 'gemini' && !provider.googleApiKey) {
            provider.googleApiKey = process.env.GOOGLE_API_KEY;
        }
        if (provider.type === 'claude' && !provider.apiKey) {
            provider.apiKey = process.env.ANTHROPIC_API_KEY;
        }
        if (provider.type === 'openai' && !provider.apiKey) {
            provider.apiKey = process.env.OPENAI_API_KEY;
        }
    }

    // Telegram token from env
    if (config.channels?.telegram && !config.channels.telegram.token) {
        config.channels.telegram.token = process.env.TELEGRAM_TOKEN;
    }

    // Obsidian vault path from env
    if (config.obsidian?.enabled && !config.obsidian.vaultPath) {
        config.obsidian.vaultPath = process.env.OBSIDIAN_VAULT_PATH;
    }
}

function loadFromEnv(): AppConfig {
    // ... existing loadFromEnv content ...
    const config = {
        dataDir: process.env.DATA_DIR || './data',
        logLevel: process.env.LOG_LEVEL || 'info',
        providers: [],
        defaultProvider: '',
        channels: {
            telegram: {
                enabled: !!process.env.TELEGRAM_TOKEN,
                token: process.env.TELEGRAM_TOKEN,
                authorizedUsers: process.env.TELEGRAM_AUTHORIZED_USERS
                    ? process.env.TELEGRAM_AUTHORIZED_USERS.split(',').map(id => parseInt(id.trim(), 10))
                    : [],
            },
        },
    } as any;

    if (process.env.GOOGLE_API_KEY) {
        config.providers.push({
            id: 'gemini-default',
            type: 'gemini',
            googleApiKey: process.env.GOOGLE_API_KEY,
            model: process.env.GOOGLE_MODEL || 'gemini-1.5-flash',
        });
        config.defaultProvider = 'gemini-default';
    } else if (process.env.ANTHROPIC_API_KEY) {
        config.providers.push({
            id: 'claude-default',
            type: 'claude',
            apiKey: process.env.ANTHROPIC_API_KEY,
            model: 'claude-3-5-sonnet-20241022',
        });
        config.defaultProvider = 'claude-default';
    }

    config.obsidian = {
        enabled: !!process.env.OBSIDIAN_VAULT_PATH,
        vaultPath: process.env.OBSIDIAN_VAULT_PATH,
    };

    return AppConfigSchema.parse(config);
}
