import { z } from 'zod';
import { ToolExecutionContext } from '../registry.js';

export const getCostsTool = {
    name: 'get_usage_costs',
    description: `Get token usage and cost statistics for the current session or total across all sessions.
Use this to inform the user about API costs or to be mindful of token consumption.`,
    
    parameters: z.object({
        scope: z.enum(['session', 'total']).default('session')
            .describe('Whether to get costs for current session or total across all sessions'),
    }),
    
    async execute(args: { scope: string }, context?: ToolExecutionContext) {
        const container = (global as any).container;
        const sessions = container?.sessions;
        if (!sessions) {
            return { error: 'Session store not available' };
        }

        if (args.scope === 'total') {
            const { totalCost, totalTokens } = sessions.getTotalCosts();
            return {
                scope: 'total',
                total_tokens: totalTokens,
                total_cost_usd: totalCost.toFixed(4),
                formatted: `Total usage across all sessions: ${totalTokens.toLocaleString()} tokens ($${totalCost.toFixed(4)} USD)`,
            };
        }

        // For session scope - use context if available
        if (context?.sessionId) {
            const costs = sessions.getSessionCosts(context.sessionId);
            return {
                scope: 'session',
                session_id: context.sessionId,
                session_key: context.sessionKey,
                total_tokens: costs.totalTokens,
                total_cost_usd: costs.totalCost.toFixed(4),
                formatted: `Current session usage: ${costs.totalTokens.toLocaleString()} tokens ($${costs.totalCost.toFixed(4)} USD)`,
            };
        }

        return {
            scope: 'session',
            error: 'Session context not available',
            suggestion: 'Use scope="total" for overall costs.',
        };
    },
};

export const estimateCostTool = {
    name: 'estimate_message_cost',
    description: `Estimate the cost of a potential response based on expected token count.
Use this before generating very long responses to warn users about potential costs.`,
    
    parameters: z.object({
        estimated_tokens: z.number().min(1)
            .describe('Estimated number of tokens for the planned response'),
        model: z.string().optional()
            .describe('Model being used (defaults to current)'),
    }),
    
    async execute(args: { estimated_tokens: number; model?: string }) {
        const config = (global as any).container?.config;
        const currentModel = args.model || config?.providers?.[0]?.model || 'gemini-2.5-flash';
        
        // Cost rates per token
        let rate = 0.000000075; // $0.075 / 1M tokens (Flash)
        if (currentModel.includes('pro')) rate = 0.00000125; // $1.25 / 1M
        if (currentModel.includes('claude')) rate = 0.000003; // $3 / 1M (Claude Sonnet)
        if (currentModel.includes('gpt-4')) rate = 0.00001; // $10 / 1M
        
        const estimatedCost = args.estimated_tokens * rate;
        
        return {
            estimated_tokens: args.estimated_tokens,
            model: currentModel,
            estimated_cost_usd: estimatedCost.toFixed(6),
            formatted: `Estimated ${args.estimated_tokens.toLocaleString()} tokens ≈ $${estimatedCost.toFixed(6)} USD (${currentModel})`,
        };
    },
};
