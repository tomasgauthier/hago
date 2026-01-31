import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider, LLMMessage, StreamEvent } from './types.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export class GeminiProvider implements LLMProvider {
    private genAI: GoogleGenerativeAI;
    public id: string;
    private modelName: string;

    constructor(config: { id: string; apiKey: string; model: string }) {
        this.id = config.id;
        this.modelName = config.model;
        this.genAI = new GoogleGenerativeAI(config.apiKey);
    }

    async *stream(params: {
        systemPrompt: string;
        messages: LLMMessage[];
        tools?: any[];
    }): AsyncGenerator<StreamEvent> {
        try {
            const model = this.genAI.getGenerativeModel({
                model: this.modelName,
                systemInstruction: params.systemPrompt,
                tools: params.tools ? [{ functionDeclarations: params.tools }] : undefined,
            });

            const contents: any[] = [];
            let lastFunctionTurn: any = null;

            for (const m of params.messages) {
                if (m.role === 'system') continue;

                if (m.role === 'tool') {
                    const part = {
                        functionResponse: {
                            name: m.toolCallId || 'unknown',
                            response: { content: m.content }
                        }
                    };

                    if (lastFunctionTurn) {
                        lastFunctionTurn.parts.push(part);
                    } else {
                        lastFunctionTurn = { role: 'function', parts: [part] };
                        contents.push(lastFunctionTurn);
                    }
                    continue;
                }

                // If not a tool message, reset function turn tracking
                lastFunctionTurn = null;

                const hasFunctionCalls = m.role === 'assistant' && (m.toolCalls?.length || m.toolCallId);

                const parts: any[] = [];
                // Only include text if it's non-empty, or if there are no function calls
                if (m.content && (!hasFunctionCalls || m.content.trim())) {
                    parts.push({ text: m.content });
                }

                if (hasFunctionCalls) {
                    const calls = m.toolCalls || [{ id: m.toolCallId!, name: m.toolCallId!, args: {} }];
                    calls.forEach(call => {
                        parts.push({
                            functionCall: {
                                name: call.name,
                                args: call.args || {}
                            }
                        });
                    });
                }

                if (parts.length === 0) {
                    parts.push({ text: '' });
                }

                contents.push({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts,
                });
            }

            // Validate Gemini ordering: function response must follow function call
            const validated: any[] = [];
            for (let i = 0; i < contents.length; i++) {
                const c = contents[i];
                const hasFnCall = c.parts?.some((p: any) => p.functionCall);
                if (hasFnCall) {
                    const next = contents[i + 1];
                    if (!next || next.role !== 'function') {
                        // Skip orphaned function call turn (no matching response)
                        logger.warn('Skipping orphaned function call turn in history (no function response follows)');
                        continue;
                    }
                }
                if (c.role === 'function') {
                    const prev = validated[validated.length - 1];
                    if (!prev || !prev.parts?.some((p: any) => p.functionCall)) {
                        // Skip orphaned function response (no preceding function call)
                        logger.warn('Skipping orphaned function response in history (no function call precedes)');
                        continue;
                    }
                }
                validated.push(c);
            }

            const result = await model.generateContentStream({
                contents: validated,
            });

            for await (const chunk of result.stream) {
                const calls = chunk.functionCalls();
                if (calls && calls.length > 0) {
                    yield {
                        type: 'tool_call',
                        toolCalls: calls.map(c => ({
                            id: c.name,
                            name: c.name,
                            args: c.args
                        }))
                    };
                    return;
                }

                const chunkText = chunk.text();
                if (chunkText) {
                    yield { type: 'text', content: chunkText };
                }
            }

            // Extract usage at the end
            const response = await result.response;
            const usage = response.usageMetadata;

            yield {
                type: 'done',
                usage: usage ? {
                    inputTokens: usage.promptTokenCount,
                    outputTokens: usage.candidatesTokenCount,
                    totalTokens: usage.totalTokenCount
                } : undefined
            };
        } catch (err: any) {
            logger.error(`Gemini stream error: ${err.message}`);
            yield { type: 'error', error: err.message };
            throw new AppError(`Gemini error: ${err.message}`, 'LLM_ERROR', 500, err);
        }
    }

    async getEmbedding(text: string): Promise<number[]> {
        try {
            const model = this.genAI.getGenerativeModel({ model: 'text-embedding-004' });
            const result = await model.embedContent(text);
            return result.embedding.values;
        } catch (err: any) {
            logger.error(`Gemini embedding error: ${err.message}`);
            throw new AppError(`Gemini embedding error: ${err.message}`, 'LLM_ERROR', 500, err);
        }
    }
}
