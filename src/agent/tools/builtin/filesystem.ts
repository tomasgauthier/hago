/**
 * File system tools with permission controls
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { ToolDefinition, ToolExecutionContext } from '../registry.js';
import type { PermissionManager } from '../../../utils/permissions.js';
import { PermissionLevel } from '../../../utils/permissions.js';
import type { Logger } from 'pino';

/**
 * Create file system tools with permission controls
 */
export function createFileSystemTools(
  logger: Logger,
  permissions: PermissionManager
): ToolDefinition[] {
  return [
    // Read file
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
          const content = await fs.readFile(absolutePath, encoding as BufferEncoding);

          const stats = await fs.stat(absolutePath);
          const sizeKb = (stats.size / 1024).toFixed(2);

          logger.info({ path: absolutePath, size: sizeKb }, 'Read file');

          // Truncate very large files
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

    // Write file
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

          // Ensure directory exists
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

    // Append to file
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

          // Ensure directory exists
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

    // List directory
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

    // Delete file
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

          // Check if file exists and get size before deleting
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

    // Create directory
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

    // Delete directory
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

        // This is a privileged operation
        permissions.checkPermission('fs_delete_directory', PermissionLevel.PRIVILEGED);
        permissions.checkFilePath(dirPath, 'delete');

        try {
          const absolutePath = path.resolve(dirPath);

          // Safety check: don't delete system directories
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

    // Copy file
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

          // Ensure destination directory exists
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

    // Move/rename file
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

          // Ensure destination directory exists
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

    // Get file info
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
