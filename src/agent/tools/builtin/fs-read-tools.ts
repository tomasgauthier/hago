/**
 * File system read-only tools (READ_ONLY permission level)
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { ToolDefinition } from '../registry.js';
import type { PermissionManager } from '../../../utils/permissions.js';
import { PermissionLevel } from '../../../utils/permissions.js';
import type { Logger } from 'pino';

export function createFsReadTools(
  logger: Logger,
  permissions: PermissionManager
): ToolDefinition[] {
  return [
    {
      name: 'fs_read_file',
      description: 'Read the contents of a file. Returns the file content as text.',
      parameters: z.object({
        path: z.string().describe('Path to the file to read'),
        encoding: z
          .enum(['utf8', 'base64'])
          .optional()
          .default('utf8')
          .describe('File encoding (utf8 for text, base64 for binary)'),
      }),
      execute: async (params: any) => {
        const { path: filePath, encoding } = params;

        permissions.checkPermission('fs_read_file', PermissionLevel.READ_ONLY);
        permissions.checkFilePath(filePath, 'read');

        try {
          const absolutePath = path.resolve(filePath);
          const content = await fs.readFile(absolutePath, encoding as any);

          const stats = await fs.stat(absolutePath);
          const sizeKb = (stats.size / 1024).toFixed(2);

          logger.info({ path: absolutePath, size: sizeKb }, 'Read file');

          const maxLength = 50000;
          const contentStr = content.toString();
          if (contentStr.length > maxLength) {
            return `${contentStr.substring(0, maxLength)}\n\n... (file truncated, ${sizeKb}KB total)`;
          }

          return contentStr;
        } catch (error) {
          logger.error({ error, path: filePath }, 'Failed to read file');
          return `Failed to read file: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    {
      name: 'fs_list_directory',
      description: 'List files and directories in a directory. Returns names, sizes, and modification times.',
      parameters: z.object({
        path: z.string().describe('Path to the directory to list'),
        recursive: z
          .boolean()
          .optional()
          .default(false)
          .describe('List subdirectories recursively'),
      }),
      execute: async (params: any) => {
        const { path: dirPath, recursive } = params;

        permissions.checkPermission('fs_list_directory', PermissionLevel.READ_ONLY);
        permissions.checkFilePath(dirPath, 'read');

        try {
          const absolutePath = path.resolve(dirPath);

          const listDir = async (dir: string, prefix = ''): Promise<string[]> => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            const results: string[] = [];

            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;

              const stats = await fs.stat(fullPath);
              const sizeKb = (stats.size / 1024).toFixed(2);
              const modified = stats.mtime.toISOString().split('T')[0];

              const type = entry.isDirectory() ? 'DIR ' : 'FILE';
              const size = entry.isDirectory() ? '     -' : `${sizeKb.padStart(6)}KB`;

              results.push(`${type} ${size} ${modified} ${relativePath}`);

              if (recursive && entry.isDirectory()) {
                const subResults = await listDir(fullPath, relativePath);
                results.push(...subResults);
              }
            }

            return results;
          };

          const results = await listDir(absolutePath);

          logger.info({ path: absolutePath, count: results.length }, 'Listed directory');

          if (results.length === 0) {
            return 'Directory is empty';
          }

          return `Contents of ${absolutePath}:\n\n${results.join('\n')}`;
        } catch (error) {
          logger.error({ error, path: dirPath }, 'Failed to list directory');
          return `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    {
      name: 'fs_file_info',
      description: 'Get information about a file or directory (size, creation time, modification time, etc.).',
      parameters: z.object({
        path: z.string().describe('Path to the file or directory'),
      }),
      execute: async (params: any) => {
        const { path: filePath } = params;

        permissions.checkPermission('fs_file_info', PermissionLevel.READ_ONLY);
        permissions.checkFilePath(filePath, 'read');

        try {
          const absolutePath = path.resolve(filePath);
          const stats = await fs.stat(absolutePath);

          const info = {
            path: absolutePath,
            type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
            size: `${(stats.size / 1024).toFixed(2)}KB`,
            created: stats.birthtime.toISOString(),
            modified: stats.mtime.toISOString(),
            accessed: stats.atime.toISOString(),
          };

          logger.info({ path: absolutePath }, 'Got file info');

          return JSON.stringify(info, null, 2);
        } catch (error) {
          logger.error({ error, path: filePath }, 'Failed to get file info');
          return `Failed to get file info: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  ];
}
