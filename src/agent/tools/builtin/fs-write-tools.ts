/**
 * File system write/mutate tools (WRITE_SAFE / PRIVILEGED permission levels)
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { ToolDefinition } from '../registry.js';
import type { PermissionManager } from '../../../utils/permissions.js';
import { PermissionLevel } from '../../../utils/permissions.js';
import type { Logger } from 'pino';

export function createFsWriteTools(
  logger: Logger,
  permissions: PermissionManager
): ToolDefinition[] {
  return [
    {
      name: 'fs_write_file',
      description: 'Write content to a file. Creates the file if it doesn\'t exist, overwrites if it does.',
      parameters: z.object({
        path: z.string().describe('Path to the file to write'),
        content: z.string().describe('Content to write to the file'),
        encoding: z
          .enum(['utf8', 'base64'])
          .optional()
          .default('utf8')
          .describe('File encoding'),
      }),
      execute: async (params: any) => {
        const { path: filePath, content, encoding } = params;

        permissions.checkPermission('fs_write_file', PermissionLevel.WRITE_SAFE);
        permissions.checkFilePath(filePath, 'write');

        try {
          const absolutePath = path.resolve(filePath);
          await fs.mkdir(path.dirname(absolutePath), { recursive: true });
          await fs.writeFile(absolutePath, content, encoding);

          const stats = await fs.stat(absolutePath);
          const sizeKb = (stats.size / 1024).toFixed(2);

          logger.info({ path: absolutePath, size: sizeKb }, 'Wrote file');
          return `Successfully wrote ${sizeKb}KB to ${absolutePath}`;
        } catch (error) {
          logger.error({ error, path: filePath }, 'Failed to write file');
          return `Failed to write file: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    {
      name: 'fs_append_file',
      description: 'Append content to the end of a file. Creates the file if it doesn\'t exist.',
      parameters: z.object({
        path: z.string().describe('Path to the file to append to'),
        content: z.string().describe('Content to append to the file'),
      }),
      execute: async (params: any) => {
        const { path: filePath, content } = params;

        permissions.checkPermission('fs_append_file', PermissionLevel.WRITE_SAFE);
        permissions.checkFilePath(filePath, 'write');

        try {
          const absolutePath = path.resolve(filePath);
          await fs.mkdir(path.dirname(absolutePath), { recursive: true });
          await fs.appendFile(absolutePath, content, 'utf8');

          const stats = await fs.stat(absolutePath);
          const sizeKb = (stats.size / 1024).toFixed(2);

          logger.info({ path: absolutePath, size: sizeKb }, 'Appended to file');
          return `Successfully appended to ${absolutePath} (now ${sizeKb}KB)`;
        } catch (error) {
          logger.error({ error, path: filePath }, 'Failed to append to file');
          return `Failed to append to file: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    {
      name: 'fs_delete_file',
      description: 'Delete a file. Use with caution - this cannot be undone!',
      parameters: z.object({
        path: z.string().describe('Path to the file to delete'),
      }),
      execute: async (params: any) => {
        const { path: filePath } = params;

        permissions.checkPermission('fs_delete_file', PermissionLevel.WRITE_SAFE);
        permissions.checkFilePath(filePath, 'delete');

        try {
          const absolutePath = path.resolve(filePath);
          const stats = await fs.stat(absolutePath);
          if (stats.isDirectory()) {
            return `Cannot delete: ${absolutePath} is a directory. Use fs_delete_directory instead.`;
          }

          const sizeKb = (stats.size / 1024).toFixed(2);
          await fs.unlink(absolutePath);

          logger.warn({ path: absolutePath, size: sizeKb }, 'Deleted file');
          return `Successfully deleted ${absolutePath} (${sizeKb}KB)`;
        } catch (error) {
          logger.error({ error, path: filePath }, 'Failed to delete file');
          return `Failed to delete file: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    {
      name: 'fs_create_directory',
      description: 'Create a new directory. Creates parent directories if they don\'t exist.',
      parameters: z.object({
        path: z.string().describe('Path to the directory to create'),
      }),
      execute: async (params: any) => {
        const { path: dirPath } = params;

        permissions.checkPermission('fs_create_directory', PermissionLevel.WRITE_SAFE);
        permissions.checkFilePath(dirPath, 'write');

        try {
          const absolutePath = path.resolve(dirPath);
          await fs.mkdir(absolutePath, { recursive: true });

          logger.info({ path: absolutePath }, 'Created directory');
          return `Successfully created directory: ${absolutePath}`;
        } catch (error) {
          logger.error({ error, path: dirPath }, 'Failed to create directory');
          return `Failed to create directory: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    {
      name: 'fs_delete_directory',
      description: 'Delete a directory and all its contents. EXTREMELY DANGEROUS - use with extreme caution!',
      parameters: z.object({
        path: z.string().describe('Path to the directory to delete'),
        recursive: z
          .boolean()
          .optional()
          .default(false)
          .describe('Delete directory and all contents recursively'),
      }),
      execute: async (params: any) => {
        const { path: dirPath, recursive } = params;

        permissions.checkPermission('fs_delete_directory', PermissionLevel.PRIVILEGED);
        permissions.checkFilePath(dirPath, 'delete');

        try {
          const absolutePath = path.resolve(dirPath);

          const dangerousPaths = ['/', 'C:\\', '/home', '/Users', process.cwd()];
          if (dangerousPaths.some((p) => absolutePath === path.resolve(p))) {
            return `FORBIDDEN: Cannot delete system directory ${absolutePath}`;
          }

          await fs.rm(absolutePath, { recursive, force: true });

          logger.warn({ path: absolutePath, recursive }, 'Deleted directory');
          return `Successfully deleted directory: ${absolutePath}`;
        } catch (error) {
          logger.error({ error, path: dirPath }, 'Failed to delete directory');
          return `Failed to delete directory: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    {
      name: 'fs_copy_file',
      description: 'Copy a file from source to destination.',
      parameters: z.object({
        source: z.string().describe('Source file path'),
        destination: z.string().describe('Destination file path'),
      }),
      execute: async (params: any) => {
        const { source, destination } = params;

        permissions.checkPermission('fs_copy_file', PermissionLevel.WRITE_SAFE);
        permissions.checkFilePath(source, 'read');
        permissions.checkFilePath(destination, 'write');

        try {
          const absoluteSource = path.resolve(source);
          const absoluteDest = path.resolve(destination);

          await fs.mkdir(path.dirname(absoluteDest), { recursive: true });
          await fs.copyFile(absoluteSource, absoluteDest);

          const stats = await fs.stat(absoluteDest);
          const sizeKb = (stats.size / 1024).toFixed(2);

          logger.info({ source: absoluteSource, destination: absoluteDest, size: sizeKb }, 'Copied file');
          return `Successfully copied ${absoluteSource} to ${absoluteDest} (${sizeKb}KB)`;
        } catch (error) {
          logger.error({ error, source, destination }, 'Failed to copy file');
          return `Failed to copy file: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    {
      name: 'fs_move_file',
      description: 'Move or rename a file from source to destination.',
      parameters: z.object({
        source: z.string().describe('Source file path'),
        destination: z.string().describe('Destination file path'),
      }),
      execute: async (params: any) => {
        const { source, destination } = params;

        permissions.checkPermission('fs_move_file', PermissionLevel.WRITE_SAFE);
        permissions.checkFilePath(source, 'delete');
        permissions.checkFilePath(destination, 'write');

        try {
          const absoluteSource = path.resolve(source);
          const absoluteDest = path.resolve(destination);

          await fs.mkdir(path.dirname(absoluteDest), { recursive: true });
          await fs.rename(absoluteSource, absoluteDest);

          logger.info({ source: absoluteSource, destination: absoluteDest }, 'Moved file');
          return `Successfully moved ${absoluteSource} to ${absoluteDest}`;
        } catch (error) {
          logger.error({ error, source, destination }, 'Failed to move file');
          return `Failed to move file: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  ];
}
