import { z } from 'zod';
import { ToolDefinition } from '../registry.js';
import { logger } from '../../../utils/logger.js';

interface BraveSearchResult {
    title: string;
    url: string;
    description: string;
}

export const searchTool: ToolDefinition = {
    name: 'web_search',
    description: 'Search the web for real-time information using Brave Search API. Requires BRAVE_SEARCH_API_KEY in .env.',
    parameters: z.object({
        query: z.string().describe('The search query'),
        count: z.number().optional().describe('Number of results (1-20, default 5)'),
    }),
    execute: async ({ query, count = 5 }) => {
        const apiKey = process.env.BRAVE_SEARCH_API_KEY;

        if (!apiKey) {
            return 'Web search is not configured. Set BRAVE_SEARCH_API_KEY in .env to enable it.';
        }

        try {
            const params = new URLSearchParams({
                q: query,
                count: String(Math.min(Math.max(count, 1), 20)),
            });

            const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
                headers: {
                    'Accept': 'application/json',
                    'Accept-Encoding': 'gzip',
                    'X-Subscription-Token': apiKey,
                },
            });

            if (!response.ok) {
                const errText = await response.text();
                logger.error(`Brave Search API error: ${response.status} ${errText}`);
                return `Search failed (HTTP ${response.status}). Check API key configuration.`;
            }

            const data = await response.json() as any;
            const results: BraveSearchResult[] = (data.web?.results || []).map((item: any) => ({
                title: item.title,
                url: item.url,
                description: item.description,
            }));

            if (results.length === 0) {
                return `No results found for "${query}".`;
            }

            return results.map((r, i) =>
                `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`
            ).join('\n\n');
        } catch (err: any) {
            logger.error(`Web search error: ${err.message}`);
            return `Search failed: ${err.message}`;
        }
    },
};
