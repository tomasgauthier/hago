import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, LLMMessage, StreamEvent, ToolCall } from './types.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { withRetry } from '../../utils/retry.js';

export class ClaudeProvider implements LLMProvider {
    private client: Anthropic;
    public id: string;
    public model: string;

    constructor(config: { id: string; apiKey: string; model: string }) {
        this.id = config.id;
        this.model = config.model;
        this.client = new Anthropic({ apiKey: config.apiKey });
    }

    async *stream(params: {
        systemPrompt: string;
        messages: LLMMessage[];
        tools?: any[];
    }): AsyncGenerator<StreamEvent> {
        try {
            const messages: Anthropic.MessageParam[] = [];

            for (const m of params.messages) {
                if (m.role === 'system') continue;

                if (m.role === 'tool') {
                    // Tool result — add as user message with tool_result content block
                    messages.push({
                        role: 'user',
                        content: [{
                            type: 'tool_result',
                            tool_use_id: m.toolCallId || 'unknown',
                            content: m.content,
                        }],
                    });
                    continue;
                }

                if (m.role === 'assistant' && m.toolCalls?.length) {
                    // Assistant message with tool calls
                    const content: Anthropic.ContentBlockParam[] = [];
                    if (m.content?.trim()) {
                        content.push({ type: 'text', text: m.content });
                    }
                    for (const call of m.toolCalls) {
                        content.push({
                            type: 'tool_use',
                            id: call.id,
                            name: call.name,
                            input: call.args || {},
                        });
                    }
                    messages.push({ role: 'assistant', content });
                    continue;
                }

                messages.push({
                    role: m.role === 'assistant' ? 'assistant' : 'user',
                    content: m.content,
                });
            }

            // Convert tool definitions to Anthropic format
            const tools: Anthropic.Tool[] | undefined = params.tools?.map(t => ({
                name: t.name,
                description: t.description || '',
                input_schema: t.parameters || { type: 'object' as const, properties: {} },
            }));

            const stream = await withRetry(
                () => this.client.messages.create({
                    model: this.model,
                    max_tokens: 4096,
                    system: params.systemPrompt,
                    messages,
                    ...(tools?.length ? { tools } : {}),
                    stream: true,
                }),
                { label: `Claude/${this.model}` },
            );

            let inputTokens = 0;
            let outputTokens = 0;
            let currentToolId = '';
            let currentToolName = '';
            let currentToolArgs = '';

            for await (const chunk of stream) {
                // Track usage from message_start
                if (chunk.type === 'message_start' && chunk.message?.usage) {
                    inputTokens = chunk.message.usage.input_tokens;
                }
                if (chunk.type === 'message_delta' && (chunk as any).usage) {
                    outputTokens = (chunk as any).usage.output_tokens;
                }

                if (chunk.type === 'content_block_start') {
                    const block = (chunk as any).content_block;
                    if (block?.type === 'tool_use') {
                        currentToolId = block.id;
                        currentToolName = block.name;
                        currentToolArgs = '';
                    }
                }

                if (chunk.type === 'content_block_delta') {
                    const delta = chunk.delta;
                    if (delta.type === 'text_delta') {
                        yield { type: 'text', content: delta.text };
                    } else if (delta.type === 'input_json_delta') {
                        currentToolArgs += (delta as any).partial_json || '';
                    }
                }

                if (chunk.type === 'content_block_stop' && currentToolName) {
                    let args = {};
                    try {
                        args = currentToolArgs ? JSON.parse(currentToolArgs) : {};
                    } catch {
                        logger.warn(`Failed to parse tool args for ${currentToolName}: ${currentToolArgs}`);
                    }
                    yield {
                        type: 'tool_call',
                        toolCalls: [{
                            id: currentToolId,
                            name: currentToolName,
                            args,
                        }],
                    };
                    currentToolId = '';
                    currentToolName = '';
                    currentToolArgs = '';
                }
            }

            yield {
                type: 'done',
                usage: {
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                },
            };
        } catch (err: any) {
            logger.error(`Claude stream error: ${err.message}`);
            yield { type: 'error', error: err.message };
            throw new AppError(`Claude error: ${err.message}`, 'LLM_ERROR', 500, err);
        }
    }

    async getEmbedding(text: string): Promise<number[]> {
        throw new AppError('Claude does not support embeddings yet.', 'LLM_ERROR', 400);
    }
}
