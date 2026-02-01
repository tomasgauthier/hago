import { Ollama } from 'ollama';
import { LLMProvider, LLMMessage, StreamEvent } from './types.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export class OllamaProvider implements LLMProvider {
    private client: Ollama;
    public id: string;
    public model: string;

    constructor(config: { id: string; model: string; baseUrl?: string }) {
        this.id = config.id;
        this.model = config.model;
        this.client = new Ollama({ host: config.baseUrl || 'http://localhost:11434' });
    }

    async *stream(params: {
        systemPrompt: string;
        messages: LLMMessage[];
    }): AsyncGenerator<StreamEvent> {
        try {
            const messages = [
                { role: 'system', content: params.systemPrompt },
                ...params.messages.map(m => ({
                    role: m.role,
                    content: m.content,
                })),
            ];

            const response = await this.client.chat({
                model: this.model,
                messages,
                stream: true,
            });

            for await (const part of response) {
                if (part.message?.content) {
                    yield { type: 'text', content: part.message.content };
                }
            }
            yield { type: 'done' };
        } catch (err: any) {
            logger.error(`Ollama stream error: ${err.message}`);
            yield { type: 'error', error: err.message };
            throw new AppError(`Ollama error: ${err.message}`, 'LLM_ERROR', 500, err);
        }
    }

    async getEmbedding(text: string): Promise<number[]> {
        try {
            const response = await this.client.embeddings({
                model: this.model,
                prompt: text,
            });
            return response.embedding;
        } catch (err: any) {
            logger.error(`Ollama embedding error: ${err.message}`);
            throw new AppError(`Ollama error: ${err.message}`, 'LLM_ERROR', 500, err);
        }
    }
}
