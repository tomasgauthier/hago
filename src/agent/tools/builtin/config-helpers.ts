/**
 * Config file helpers — read, write, backup operations for config.json5
 */

import { promises as fs } from 'fs';
import JSON5 from 'json5';
import type { Logger } from 'pino';

const CONFIG_PATH = './config.json5';

export { CONFIG_PATH };

export async function readConfig(): Promise<{ raw: string; parsed: any }> {
  const raw = await fs.readFile(CONFIG_PATH, 'utf8');
  return { raw, parsed: JSON5.parse(raw) };
}

export async function writeConfig(config: any): Promise<void> {
  const content = JSON5.stringify(config, null, 2);
  await fs.writeFile(CONFIG_PATH, content, 'utf8');
}

export async function createBackup(logger: Logger, rawContent?: string): Promise<string> {
  const content = rawContent ?? (await fs.readFile(CONFIG_PATH, 'utf8'));
  const backupPath = `${CONFIG_PATH}.backup.${Date.now()}`;
  await fs.writeFile(backupPath, content, 'utf8');
  logger.info({ backupPath }, 'Created config backup');
  return backupPath;
}

export async function listBackups(): Promise<{ filename: string; date: string; sizeKb: string }[]> {
  const files = await fs.readdir('.');
  const backups = files.filter((f: string) => f.startsWith('config.json5.backup.'));

  return Promise.all(
    backups.map(async (filename: string) => {
      const stats = await fs.stat(filename);
      const timestamp = parseInt(filename.split('.').pop() || '0', 10);
      const date = new Date(timestamp).toISOString();
      const sizeKb = (stats.size / 1024).toFixed(2);
      return { filename, date, sizeKb };
    })
  );
}

/**
 * Set a value at a dot-notation path in an object
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function setNestedValue(obj: any, dotPath: string, value: unknown): { oldValue: unknown } {
  const parts = dotPath.split('.');

  for (const part of parts) {
    if (FORBIDDEN_KEYS.has(part)) {
      throw new Error(`Forbidden config path segment: "${part}"`);
    }
  }

  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }

  const lastPart = parts[parts.length - 1];
  const oldValue = current[lastPart];
  current[lastPart] = value;

  return { oldValue };
}
