/**
 * Plugin system — loads tool definitions from a plugins directory.
 * Each plugin is a .js/.ts file that exports a `register` function.
 *
 * Plugin API:
 *   export function register(ctx: PluginContext): ToolDefinition[]
 *
 * Example plugin (plugins/hello.ts):
 *   import { z } from 'zod';
 *   export function register() {
 *     return [{
 *       name: 'hello',
 *       description: 'Say hello',
 *       parameters: z.object({ name: z.string() }),
 *       execute: async ({ name }) => `Hello, ${name}!`,
 *     }];
 *   }
 */

import { ToolRegistry, ToolDefinition } from '../agent/tools/registry.js';
import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

export interface PluginContext {
    dataDir: string;
    db: any;
}

export async function loadPlugins(pluginDir: string, registry: ToolRegistry, ctx: PluginContext): Promise<number> {
    if (!fs.existsSync(pluginDir)) {
        logger.info(`[Plugins] No plugins directory found at ${pluginDir}`);
        return 0;
    }

    const files = fs.readdirSync(pluginDir).filter(f => f.endsWith('.js') || f.endsWith('.ts'));
    let loaded = 0;

    for (const file of files) {
        try {
            const modulePath = path.resolve(pluginDir, file);
            const mod = await import(modulePath);

            if (typeof mod.register !== 'function') {
                logger.warn(`[Plugins] ${file}: no register() export, skipping`);
                continue;
            }

            const tools: ToolDefinition[] = mod.register(ctx);
            for (const tool of tools) {
                registry.register(tool);
                loaded++;
            }

            logger.info(`[Plugins] Loaded ${tools.length} tools from ${file}`);
        } catch (err: any) {
            logger.error(`[Plugins] Failed to load ${file}: ${err.message}`);
        }
    }

    return loaded;
}
