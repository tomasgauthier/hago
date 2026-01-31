import OpenAI from 'openai';
import { LLMProvider, LLMMessage, StreamEvent } from './types.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export class OpenAIProvider implements LLMProvider {
    private client: OpenAI;
    public id: string;
    private model: string;

    constructor(config: { id: string; apiKey: string; model: string; baseUrl?: string }) {
        this.id = config.id;
        this.model = config.model;
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseUrl,
        });
    }

    async *stream(params: {
        systemPrompt: string;
        messages: LLMMessage[];
    }): AsyncGenerator<StreamEvent> {
        try {
            const messages: any[] = [
                { role: 'system', content: params.systemPrompt },
                ...params.messages.map(m => ({
                    role: m.role,
                    content: m.content,
                })),
            ];

            const stream = await this.client.chat.completions.create({
                model: this.model,
                messages,
                stream: true,
            });

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                    yield { type: 'text', content };
                }
            }
            yield { type: 'done' };
        } catch (err: any) {
            logger.error(`OpenAI stream error: ${err.message}`);
            yield { type: 'error', error: err.message };
            throw new AppError(`OpenAI error: ${err.message}`, 'LLM_ERROR', 500, err);
        }
    }

    async getEmbedding(text: string): Promise<number[]> {
        try {
            const result = await this.client.embeddings.create({
                model: 'text-embedding-3-small',
                input: text,
            });
            return result.data[0].embedding;
        } catch (err: any) {
            logger.error(`OpenAI embedding error: ${err.message}`);
            throw new AppError(`OpenAI embedding error: ${err.message}`, 'LLM_ERROR', 500, err);
        }
    }
}
