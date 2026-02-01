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

            // Validate and fix Gemini ordering constraints:
            // 1. function response must immediately follow a function call
            // 2. No two consecutive turns with the same role (merge them)
            // 3. First turn must be 'user', not 'model' or 'function'
            const validated: any[] = [];

            for (let i = 0; i < contents.length; i++) {
                const c = contents[i];
                const hasFnCall = c.parts?.some((p: any) => p.functionCall);
                const isFnResponse = c.role === 'function';

                if (hasFnCall) {
                    // Look ahead for matching function response
                    const next = contents[i + 1];
                    if (!next || next.role !== 'function') {
                        logger.warn('Skipping orphaned function call turn (no function response follows)');
                        continue;
                    }
                    // Push both call and response together
                    validated.push(c);
                    validated.push(next);
                    i++; // Skip the response since we already pushed it
                    continue;
                }

                if (isFnResponse) {
                    // Should have been consumed by the function call handler above
                    const prev = validated[validated.length - 1];
                    if (!prev || !prev.parts?.some((p: any) => p.functionCall)) {
                        logger.warn('Skipping orphaned function response (no function call precedes)');
                        continue;
                    }
                    validated.push(c);
                    continue;
                }

                // Merge consecutive same-role turns (e.g. two 'user' messages)
                const prev = validated[validated.length - 1];
                if (prev && prev.role === c.role) {
                    prev.parts.push(...c.parts);
                    continue;
                }

                validated.push(c);
            }

            // Ensure first turn is 'user' — strip leading model turns from history
            while (validated.length > 0 && validated[0].role !== 'user') {
                logger.warn(`Stripping leading ${validated[0].role} turn — Gemini requires user first`);
                validated.shift();
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
