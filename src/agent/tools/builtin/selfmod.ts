/**
 * Self-modification tools — allow the agent to update its own configuration
 */

import { promises as fs } from 'fs';
import { z } from 'zod';
import type { ToolDefinition } from '../registry.js';
import type { PermissionManager } from '../../../utils/permissions.js';
import { PermissionLevel } from '../../../utils/permissions.js';
import type { Logger } from 'pino';
import {
  CONFIG_PATH,
  readConfig,
  writeConfig,
  createBackup,
  listBackups,
  setNestedValue,
} from './config-helpers.js';

export function createSelfModTools(
  logger: Logger,
  permissions: PermissionManager,
  onConfigUpdate?: () => Promise<void>
): ToolDefinition[] {
  return [
    {
      name: 'config_read',
      description: 'Read the current configuration. Use this to understand current settings before making changes.',
      parameters: z.object({
        section: z
          .string()
          .optional()
          .describe('Optional: specific config section to read (e.g., "providers", "tools")'),
      }),
      execute: async (params: any) => {
        const { section } = params;
        permissions.checkPermission('config_read', PermissionLevel.READ_ONLY);

        try {
          const { parsed: config } = await readConfig();
          const result = section && section in config ? config[section] : config;

          logger.info({ section }, 'Read configuration');
          return `Current configuration${section ? ` (${section})` : ''}:\n\n${JSON.stringify(result, null, 2)}`;
        } catch (error) {
          logger.error({ error, section }, 'Failed to read configuration');
          return `Failed to read configuration: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    {
      name: 'config_update',
      description: 'Update a configuration value. This modifies the config.json5 file and triggers a reload. Use with extreme caution!',
      parameters: z.object({
        path: z
          .string()
          .describe('Dot-notation path to the config value (e.g., "defaultProvider", "tools.enabled")'),
        value: z.unknown().describe('New value to set (can be string, number, boolean, object, or array)'),
        createBackup: z
          .boolean()
          .optional()
          .default(true)
          .describe('Create a backup before modifying'),
      }),
      execute: async (params: any) => {
        const { path: configPath, value, createBackup: shouldBackup } = params;
        permissions.checkPermission('config_update', PermissionLevel.PRIVILEGED);

        try {
          const { raw, parsed: config } = await readConfig();

          if (shouldBackup) {
            await createBackup(logger, raw);
          }

          const { oldValue } = setNestedValue(config, configPath, value);
          await writeConfig(config);

          logger.warn({ path: configPath, oldValue, newValue: value }, 'Updated configuration');

          if (onConfigUpdate) await onConfigUpdate();

          return `Successfully updated configuration:\nPath: ${configPath}\nOld value: ${JSON.stringify(oldValue)}\nNew value: ${JSON.stringify(value)}\n\nConfiguration has been reloaded.`;
        } catch (error) {
          logger.error({ error, path: configPath }, 'Failed to update configuration');
          return `Failed to update configuration: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    {
      name: 'config_add_provider',
      description: 'Add a new LLM provider to the configuration.',
      parameters: z.object({
        id: z.string().describe('Unique provider ID'),
        type: z.enum(['gemini', 'claude', 'openai', 'ollama']).describe('Provider type'),
        model: z.string().describe('Model name'),
        apiKey: z.string().optional().describe('Optional API key (if different from default)'),
      }),
      execute: async (params: any) => {
        const { id, type, model, apiKey } = params;
        permissions.checkPermission('config_add_provider', PermissionLevel.PRIVILEGED);

        try {
          const { raw, parsed: config } = await readConfig();

          if (!config.providers) config.providers = [];
          if (config.providers.some((p: any) => p.id === id)) {
            return `Provider with ID "${id}" already exists. Use config_update to modify it.`;
          }

          const newProvider: any = { id, type, model };
          if (apiKey) newProvider.apiKey = apiKey;
          config.providers.push(newProvider);

          await createBackup(logger, raw);
          await writeConfig(config);

          logger.warn({ providerId: id, type, model }, 'Added new provider');
          if (onConfigUpdate) await onConfigUpdate();

          return `Successfully added provider "${id}" (${type}: ${model})`;
        } catch (error) {
          logger.error({ error, providerId: id }, 'Failed to add provider');
          return `Failed to add provider: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    {
      name: 'config_remove_provider',
      description: 'Remove an LLM provider from the configuration.',
      parameters: z.object({
        id: z.string().describe('Provider ID to remove'),
      }),
      execute: async (params: any) => {
        const { id } = params;
        permissions.checkPermission('config_remove_provider', PermissionLevel.PRIVILEGED);

        try {
          const { raw, parsed: config } = await readConfig();

          if (!config.providers) return 'No providers configured';

          const initialLength = config.providers.length;
          config.providers = config.providers.filter((p: any) => p.id !== id);

          if (config.providers.length === initialLength) {
            return `Provider "${id}" not found`;
          }

          await createBackup(logger, raw);
          await writeConfig(config);

          logger.warn({ providerId: id }, 'Removed provider');
          if (onConfigUpdate) await onConfigUpdate();

          return `Successfully removed provider "${id}"`;
        } catch (error) {
          logger.error({ error, providerId: id }, 'Failed to remove provider');
          return `Failed to remove provider: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    {
      name: 'config_list_backups',
      description: 'List all configuration backups that have been created.',
      parameters: z.object({}),
      execute: async () => {
        permissions.checkPermission('config_list_backups', PermissionLevel.READ_ONLY);

        try {
          const backups = await listBackups();

          if (backups.length === 0) return 'No configuration backups found';

          logger.info({ count: backups.length }, 'Listed config backups');
          const lines = backups.map((b) => `${b.filename} - ${b.date} (${b.sizeKb}KB)`);
          return `Configuration backups:\n\n${lines.join('\n')}`;
        } catch (error) {
          logger.error({ error }, 'Failed to list backups');
          return `Failed to list backups: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    {
      name: 'config_restore_backup',
      description: 'Restore configuration from a backup file. Use with caution!',
      parameters: z.object({
        filename: z.string().describe('Backup filename to restore from'),
      }),
      execute: async (params: any) => {
        const { filename } = params;
        permissions.checkPermission('config_restore_backup', PermissionLevel.PRIVILEGED);

        try {
          await fs.access(filename);

          const currentConfig = await fs.readFile(CONFIG_PATH, 'utf8');
          const safetyBackup = `${CONFIG_PATH}.before-restore.${Date.now()}`;
          await fs.writeFile(safetyBackup, currentConfig, 'utf8');

          const backupContent = await fs.readFile(filename, 'utf8');
          await fs.writeFile(CONFIG_PATH, backupContent, 'utf8');

          logger.warn({ filename, safetyBackup }, 'Restored config from backup');
          if (onConfigUpdate) await onConfigUpdate();

          return `Successfully restored configuration from ${filename}\nCreated safety backup at ${safetyBackup}`;
        } catch (error) {
          logger.error({ error, filename }, 'Failed to restore backup');
          return `Failed to restore backup: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    {
      name: 'system_info',
      description: 'Get information about the system Tombot is running on.',
      parameters: z.object({}),
      execute: async () => {
        permissions.checkPermission('system_info', PermissionLevel.READ_ONLY);

        try {
          const os = await import('os');

          const info = {
            platform: process.platform,
            architecture: process.arch,
            nodeVersion: process.version,
            uptime: `${(process.uptime() / 3600).toFixed(2)} hours`,
            workingDirectory: process.cwd(),
            memory: {
              total: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)}GB`,
              free: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)}GB`,
              heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB`,
            },
            cpus: os.cpus().length,
          };

          logger.info('Retrieved system info');
          return `System Information:\n\n${JSON.stringify(info, null, 2)}`;
        } catch (error) {
          logger.error({ error }, 'Failed to get system info');
          return `Failed to get system info: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  ];
}
