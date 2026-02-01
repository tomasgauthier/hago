import { z } from 'zod';

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: z.ZodObject<any>;
    execute: (args: any, context?: ToolExecutionContext) => Promise<any>;
}

export interface ToolExecutionContext {
    sessionId?: number;
    sessionKey?: string;
}

export class ToolRegistry {
    private tools: Map<string, ToolDefinition> = new Map();

    register(tool: ToolDefinition) {
        this.tools.set(tool.name, tool);
    }

    getTool(name: string) {
        return this.tools.get(name);
    }

    getAllDefinitions() {
        return Array.from(this.tools.values()).map(t => ({
            name: t.name,
            description: t.description,
            parameters: this.zodToJSONSchema(t.parameters),
        }));
    }

    private zodToJSONSchema(schema: z.ZodObject<any>) {
        const shape = schema.shape;
        const properties: any = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(shape) as any) {
            let type = 'string';
            let description = '';

            // Extract type
            let innerType = value;
            while (innerType instanceof z.ZodOptional || innerType instanceof z.ZodDefault) {
                innerType = innerType._def.innerType;
            }

            if (innerType instanceof z.ZodNumber) type = 'number';
            if (innerType instanceof z.ZodBoolean) type = 'boolean';

            // Extract description
            description = (value as any)._def.description || '';

            properties[key] = {
                type,
                ...(description ? { description } : {}),
            };

            // Check if required
            if (!(value instanceof z.ZodOptional)) {
                required.push(key);
            }
        }

        return {
            type: 'object',
            properties,
            required,
        };
    }

    async execute(name: string, args: string | any, context?: ToolExecutionContext) {
        const tool = this.getTool(name);
        if (!tool) throw new Error(`Tool ${name} not found`);

        let parsedArgs: any;
        if (typeof args === 'string') {
            try {
                parsedArgs = JSON.parse(args);
            } catch {
                throw new Error(`Invalid JSON in tool arguments for ${name}: ${args.slice(0, 200)}`);
            }
        } else {
            parsedArgs = args;
        }
        const validatedArgs = tool.parameters.parse(parsedArgs);

        const rawResult = await tool.execute(validatedArgs, context);
        return this.sanitizeToolResult(rawResult);
    }

    /**
     * Sanitize tool results to mitigate indirect prompt injection.
     * - Truncates overly long results to prevent context flooding
     * - Strips patterns that look like prompt injection attempts
     * - Wraps output in delimiters so the LLM can distinguish tool data from instructions
     */
    private sanitizeToolResult(result: any): string {
        let text = typeof result === 'string' ? result : JSON.stringify(result);

        // Truncate to prevent context flooding (max 200KB per tool result for 1M context models)
        const MAX_RESULT_LENGTH = 200_000;
        if (text.length > MAX_RESULT_LENGTH) {
            text = text.slice(0, MAX_RESULT_LENGTH) + '\n...[truncated]';
        }

        // Strip common prompt injection patterns from tool output
        const injectionPatterns = [
            /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
            /\byou\s+are\s+now\b/gi,
            /\bnew\s+instructions?\s*:/gi,
            /\bsystem\s*:\s*/gi,
            /\b(IMPORTANT|CRITICAL|URGENT)\s*:.*?(ignore|override|disregard)/gi,
            /<\/?system>/gi,
        ];

        for (const pattern of injectionPatterns) {
            text = text.replace(pattern, '[filtered]');
        }

        return `[Tool Output Start]\n${text}\n[Tool Output End]`;
    }
}
