import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ToolDefinition } from '../registry.js';
import { AppError } from '../../../utils/errors.js';

function getVaultPath(args: any): string {
    if (!args.vaultPath) {
        throw new AppError('Obsidian vault path is not configured', 'CONFIG_ERROR', 500);
    }
    return args.vaultPath;
}

export const obsidianSearchTool = (vaultPath: string): ToolDefinition => ({
    name: 'obsidian_search',
    description: 'Search for notes by filename in the Obsidian vault.',
    parameters: z.object({
        query: z.string().describe('Filename part to search for'),
    }),
    execute: async ({ query }) => {
        const files = fs.readdirSync(vaultPath, { recursive: true }) as string[];
        const matches = files.filter(f =>
            f.endsWith('.md') &&
            path.basename(f).toLowerCase().includes(query.toLowerCase())
        );
        return matches.map(m => m.replace(/\.md$/, ''));
    },
});

export const obsidianReadTool = (vaultPath: string): ToolDefinition => ({
    name: 'obsidian_read',
    description: 'Read the content of an Obsidian note.',
    parameters: z.object({
        notePath: z.string().describe('Path to the note (relative to vault root, without .md)'),
    }),
    execute: async ({ notePath }) => {
        const fullPath = path.join(vaultPath, `${notePath}.md`);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`Note not found: ${notePath}`);
        }
        return fs.readFileSync(fullPath, 'utf8');
    },
});

export const obsidianCreateTool = (vaultPath: string): ToolDefinition => ({
    name: 'obsidian_create',
    description: 'Create a new note in the Obsidian vault.',
    parameters: z.object({
        notePath: z.string().describe('Target path for the note (relative to vault root, without .md)'),
        content: z.string().describe('Markdown content for the note'),
    }),
    execute: async ({ notePath, content }) => {
        const fullPath = path.join(vaultPath, `${notePath}.md`);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, 'utf8');
        return `Note created: ${notePath}`;
    },
});

export const obsidianSearchContentTool = (vaultPath: string): ToolDefinition => ({
    name: 'obsidian_search_content',
    description: 'Search for text content inside all Obsidian notes.',
    parameters: z.object({
        query: z.string().describe('Text pattern to search for'),
    }),
    execute: async ({ query }) => {
        const files = fs.readdirSync(vaultPath, { recursive: true }) as string[];
        const mdFiles = files.filter(f => f.endsWith('.md') && !f.includes('.obsidian'));

        const results: string[] = [];
        for (const f of mdFiles) {
            const fullPath = path.join(vaultPath, f);
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.toLowerCase().includes(query.toLowerCase())) {
                results.push(f.replace(/\.md$/, ''));
            }
            if (results.length >= 10) break; // Limit results
        }
        return results;
    },
});
