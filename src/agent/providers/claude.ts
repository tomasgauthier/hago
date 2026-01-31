import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, LLMMessage, StreamEvent } from './types.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export class ClaudeProvider implements LLMProvider {
    private client: Anthropic;
    public id: string;
    private model: string;

    constructor(config: { id: string; apiKey: string; model: string }) {
        this.id = config.id;
        this.model = config.model;
        this.client = new Anthropic({ apiKey: config.apiKey });
    }

    async *stream(params: {
        systemPrompt: string;
        messages: LLMMessage[];
    }): AsyncGenerator<StreamEvent> {
        try {
            const messages = params.messages.filter(m => m.role !== 'system').map(m => ({
                role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
                content: m.content,
            }));

            const stream = await this.client.messages.create({
                model: this.model,
                max_tokens: 4096,
                system: params.systemPrompt,
                messages,
                stream: true,
            });

            for await (const chunk of stream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                    yield { type: 'text', content: chunk.delta.text };
                }
            }
            yield { type: 'done' };
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
