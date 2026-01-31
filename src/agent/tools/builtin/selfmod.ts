/**
 * Self-modification tools - allow the agent to update its own configuration
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import JSON5 from 'json5';
import { z } from 'zod';
import type { ToolDefinition, ToolExecutionContext } from '../registry.js';
import type { PermissionManager } from '../../../utils/permissions.js';
import { PermissionLevel } from '../../../utils/permissions.js';
import type { Logger } from 'pino';
import type { Config } from '../../../config/schema.js';

const CONFIG_PATH = './config.json5';

/**
 * Create self-modification tools
 */
export function createSelfModTools(
  logger: Logger,
  permissions: PermissionManager,
  onConfigUpdate?: () => Promise<void>
): ToolDefinition[] {
  return [
    // Read current configuration
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
          const configContent = await fs.readFile(CONFIG_PATH, 'utf8');
          const config = JSON5.parse(configContent);

          let result: unknown = config;
          if (section && section in config) {
            result = config[section];
          }

          logger.info({ section }, 'Read configuration');

          return `Current configuration${section ? ` (${section})` : ''}:\n\n${JSON.stringify(result, null, 2)}`;
        } catch (error) {
          logger.error({ error, section }, 'Failed to read configuration');
          return `Failed to read configuration: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    // Update configuration
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
        const { path: configPath, value, createBackup } = params;

        permissions.checkPermission('config_update', PermissionLevel.PRIVILEGED);

        try {
          const configContent = await fs.readFile(CONFIG_PATH, 'utf8');
          const config = JSON5.parse(configContent);

          // Create backup if requested
          if (createBackup) {
            const backupPath = `${CONFIG_PATH}.backup.${Date.now()}`;
            await fs.writeFile(backupPath, configContent, 'utf8');
            logger.info({ backupPath }, 'Created config backup');
          }

          // Navigate to the config path and update the value
          const pathParts = configPath.split('.');
          let current: any = config;

          for (let i = 0; i < pathParts.length - 1; i++) {
            const part = pathParts[i];
            if (!(part in current)) {
              current[part] = {};
            }
            current = current[part];
          }

          const lastPart = pathParts[pathParts.length - 1];
          const oldValue = current[lastPart];
          current[lastPart] = value;

          // Write updated config
          const updatedContent = JSON5.stringify(config, null, 2);
          await fs.writeFile(CONFIG_PATH, updatedContent, 'utf8');

          logger.warn({
            path: configPath,
            oldValue,
            newValue: value,
          }, 'Updated configuration');

          // Trigger config reload if callback provided
          if (onConfigUpdate) {
            await onConfigUpdate();
          }

          return `Successfully updated configuration:
Path: ${configPath}
Old value: ${JSON.stringify(oldValue)}
New value: ${JSON.stringify(value)}

Configuration has been reloaded.`;
        } catch (error) {
          logger.error({ error, path: configPath }, 'Failed to update configuration');
          return `Failed to update configuration: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    // Add provider
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
          const configContent = await fs.readFile(CONFIG_PATH, 'utf8');
          const config = JSON5.parse(configContent);

          // Initialize providers array if it doesn't exist
          if (!config.providers) {
            config.providers = [];
          }

          // Check if provider ID already exists
          if (config.providers.some((p: any) => p.id === id)) {
            return `Provider with ID "${id}" already exists. Use config_update to modify it.`;
          }

          // Add new provider
          const newProvider: any = { id, type, model };
          if (apiKey) {
            newProvider.apiKey = apiKey;
          }

          config.providers.push(newProvider);

          // Create backup
          const backupPath = `${CONFIG_PATH}.backup.${Date.now()}`;
          await fs.writeFile(backupPath, configContent, 'utf8');

          // Write updated config
          const updatedContent = JSON5.stringify(config, null, 2);
          await fs.writeFile(CONFIG_PATH, updatedContent, 'utf8');

          logger.warn({ providerId: id, type, model }, 'Added new provider');

          if (onConfigUpdate) {
            await onConfigUpdate();
          }

          return `Successfully added provider "${id}" (${type}: ${model})`;
        } catch (error) {
          logger.error({ error, providerId: id }, 'Failed to add provider');
          return `Failed to add provider: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    // Remove provider
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
          const configContent = await fs.readFile(CONFIG_PATH, 'utf8');
          const config = JSON5.parse(configContent);

          if (!config.providers) {
            return 'No providers configured';
          }

          const initialLength = config.providers.length;
          config.providers = config.providers.filter((p: any) => p.id !== id);

          if (config.providers.length === initialLength) {
            return `Provider "${id}" not found`;
          }

          // Create backup
          const backupPath = `${CONFIG_PATH}.backup.${Date.now()}`;
          await fs.writeFile(backupPath, configContent, 'utf8');

          // Write updated config
          const updatedContent = JSON5.stringify(config, null, 2);
          await fs.writeFile(CONFIG_PATH, updatedContent, 'utf8');

          logger.warn({ providerId: id }, 'Removed provider');

          if (onConfigUpdate) {
            await onConfigUpdate();
          }

          return `Successfully removed provider "${id}"`;
        } catch (error) {
          logger.error({ error, providerId: id }, 'Failed to remove provider');
          return `Failed to remove provider: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    // List configuration backups
    {
      name: 'config_list_backups',
      description: 'List all configuration backups that have been created.',
      parameters: z.object({}),
      execute: async () => {
        permissions.checkPermission('config_list_backups', PermissionLevel.READ_ONLY);

        try {
          const files = await fs.readdir('.');
          const backups = files.filter((f) => f.startsWith('config.json5.backup.'));

          if (backups.length === 0) {
            return 'No configuration backups found';
          }

          const backupInfo = await Promise.all(
            backups.map(async (filename) => {
              const stats = await fs.stat(filename);
              const timestamp = parseInt(filename.split('.').pop() || '0', 10);
              const date = new Date(timestamp).toISOString();
              const sizeKb = (stats.size / 1024).toFixed(2);

              return `${filename} - ${date} (${sizeKb}KB)`;
            })
          );

          logger.info({ count: backups.length }, 'Listed config backups');

          return `Configuration backups:\n\n${backupInfo.join('\n')}`;
        } catch (error) {
          logger.error({ error }, 'Failed to list backups');
          return `Failed to list backups: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    // Restore from backup
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
          // Verify backup file exists
          await fs.access(filename);

          // Create a backup of current config before restoring
          const currentConfig = await fs.readFile(CONFIG_PATH, 'utf8');
          const safetyBackup = `${CONFIG_PATH}.before-restore.${Date.now()}`;
          await fs.writeFile(safetyBackup, currentConfig, 'utf8');

          // Restore from backup
          const backupContent = await fs.readFile(filename, 'utf8');
          await fs.writeFile(CONFIG_PATH, backupContent, 'utf8');

          logger.warn({ filename, safetyBackup }, 'Restored config from backup');

          if (onConfigUpdate) {
            await onConfigUpdate();
          }

          return `Successfully restored configuration from ${filename}\nCreated safety backup at ${safetyBackup}`;
        } catch (error) {
          logger.error({ error, filename }, 'Failed to restore backup');
          return `Failed to restore backup: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    // Get system info
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
