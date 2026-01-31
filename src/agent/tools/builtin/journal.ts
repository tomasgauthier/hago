import { ToolDefinition } from '../registry.js';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export function journalTool(vaultPath: string): ToolDefinition {
    return {
        name: 'save_journal_entry',
        description: `Save a personal journal entry or important thought to Obsidian.
Use when the user wants to remember something, reflect on their day, or save a personal note.

Valid categories:
- reflection: Thoughts about experiences, lessons learned, self-analysis
- goal: Aspirations, targets, things to achieve  
- memory: Personal experiences, encounters, life events (e.g., "me encontré con...", "hoy pasó...")
- idea: Creative concepts, project ideas, insights
- gratitude: Things to be thankful for`,
        parameters: z.object({
            content: z.string().describe('The journal entry content to save'),
            tags: z.array(z.string()).optional().describe('Optional tags for categorization (e.g., health, work, family)'),
            mood: z.enum(['positive', 'neutral', 'negative']).optional().describe('The emotional tone of the entry'),
            category: z.enum(['reflection', 'goal', 'memory', 'idea', 'gratitude']).optional()
                .describe('Type of entry: reflection (self-analysis), goal (aspirations), memory (personal events/encounters), idea (creative insights), gratitude (thankfulness). Default: reflection')
        }),
        execute: async (args: any) => {
            const { content, tags = [], mood, category = 'reflection' } = args;

            // Create journal directory structure
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            const timestamp = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

            const journalDir = path.join(vaultPath, 'Journal', String(year), month);
            if (!fs.existsSync(journalDir)) {
                fs.mkdirSync(journalDir, { recursive: true });
            }

            const filename = path.join(journalDir, `${dateStr}.md`);
            const exists = fs.existsSync(filename);

            // Build entry
            const tagStr = tags.map((t: string) => `#${t.replace(/\s+/g, '-')}`).join(' ');
            const moodEmoji = mood === 'positive' ? '😊' : mood === 'negative' ? '😔' : '😐';

            const entry = `
## ${timestamp} - ${category.charAt(0).toUpperCase() + category.slice(1)} ${moodEmoji}

${content}

${tagStr ? `**Tags:** ${tagStr}` : ''}

---
`;

            // Append or create
            if (exists) {
                fs.appendFileSync(filename, entry);
            } else {
                const header = `# Journal - ${dateStr}\n\n`;
                fs.writeFileSync(filename, header + entry);
            }

            return `Journal entry saved to ${path.relative(vaultPath, filename)}. ${category === 'goal' ? 'Keep working towards your goals! 🎯' : category === 'gratitude' ? 'Gratitude is powerful! 🙏' : 'Entry recorded. 📝'}`;
        }
    };
}
