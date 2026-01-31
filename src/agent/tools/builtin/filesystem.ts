/**
 * File system tools — combines read and write tool sets
 */

import type { ToolDefinition } from '../registry.js';
import type { PermissionManager } from '../../../utils/permissions.js';
import type { Logger } from 'pino';
import { createFsReadTools } from './fs-read-tools.js';
import { createFsWriteTools } from './fs-write-tools.js';

/**
 * Create all file system tools with permission controls
 */
export function createFileSystemTools(
  logger: Logger,
  permissions: PermissionManager
): ToolDefinition[] {
  return [
    ...createFsReadTools(logger, permissions),
    ...createFsWriteTools(logger, permissions),
  ];
}
