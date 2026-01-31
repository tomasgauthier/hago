/**
 * Memory tools — expose RAG (store & query) to the agent
 */

import { z } from 'zod';
import type { ToolDefinition, ToolExecutionContext } from '../registry.js';
import type { MemoryIndex } from '../../../memory/index.js';
import type { Logger } from 'pino';

export function createMemoryTools(
  logger: Logger,
  memory: MemoryIndex
): ToolDefinition[] {
  return [
    {
      name: 'memory_store',
      description:
        'Store a piece of information in long-term memory for later retrieval. ' +
        'Use this to remember facts, user preferences, decisions, or any context that may be useful in future conversations.',
      parameters: z.object({
        content: z.string().describe('The text content to memorize'),
        tags: z
          .string()
          .optional()
          .describe('Comma-separated tags for categorization (e.g. "preference,food,user")'),
        source: z
          .string()
          .optional()
          .describe('Where this information came from (e.g. "user", "web_search", "observation")'),
      }),
      execute: async (params: any, context?: ToolExecutionContext) => {
        const { content, tags, source } = params;

        const metadata = {
          tags: tags ? tags.split(',').map((t: string) => t.trim()) : [],
          source: source || 'agent',
          sessionKey: context?.sessionKey,
          storedAt: new Date().toISOString(),
        };

        try {
          await memory.addDocument(content, metadata);
          logger.info({ contentLength: content.length, tags, source }, 'Stored memory chunk');
          return `Successfully stored in memory (${content.length} chars). Tags: ${metadata.tags.join(', ') || 'none'}`;
        } catch (err: any) {
          logger.error({ error: err }, 'Failed to store memory');
          return `Failed to store memory: ${err.message}`;
        }
      },
    },

    {
      name: 'memory_query',
      description:
        'Search long-term memory for relevant information. ' +
        'Use this to recall facts, user preferences, past decisions, or any previously stored context.',
      parameters: z.object({
        query: z.string().describe('Natural language query to search memory for'),
        limit: z
          .number()
          .optional()
          .default(5)
          .describe('Maximum number of results to return (default: 5)'),
      }),
      execute: async (params: any) => {
        const { query, limit } = params;

        try {
          const results = await memory.query(query, limit);

          if (results.length === 0) {
            logger.info({ query }, 'Memory query returned no results');
            return 'No relevant memories found for this query.';
          }

          logger.info({ query, resultCount: results.length }, 'Memory query completed');

          const formatted = results.map((r: any, i: number) => {
            const meta = r.metadata || {};
            const tags = meta.tags?.length ? ` [tags: ${meta.tags.join(', ')}]` : '';
            const dist = r.distance !== undefined ? ` (relevance: ${(1 - r.distance).toFixed(3)})` : '';
            const date = meta.storedAt ? ` — stored ${meta.storedAt}` : '';
            return `${i + 1}. ${r.content}${tags}${dist}${date}`;
          });

          return `Found ${results.length} relevant memories:\n\n${formatted.join('\n\n')}`;
        } catch (err: any) {
          logger.error({ error: err }, 'Failed to query memory');
          return `Failed to query memory: ${err.message}`;
        }
      },
    },
  ];
}
