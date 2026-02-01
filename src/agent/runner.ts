import { SessionStore } from '../sessions/store.js';
import { LLMProvider, LLMMessage, EmbeddingProvider } from './providers/types.js';
import { MemoryIndex } from '../memory/index.js';
import type { MindStore } from '../mind/store.js';
import type { ToolRegistry } from './tools/registry.js';
import { logger } from '../utils/logger.js';
import { getSystemPrompt } from './identity.js';
import { metrics } from '../utils/metrics.js';

// Regex-based stress detection — fast first-pass filter
const STRESS_PATTERNS = [
    /no[,\s]+(that'?s?\s+)?(wrong|incorrect|not what i meant)/i,
    /actually[,\s]+/i,
    /i (already )?told you/i,
    /you'?re not listening/i,
    /that'?s not what i (asked|said|meant)/i,
    /why (did you|would you)/i,
];

function detectStressRegex(text: string): boolean {
    return STRESS_PATTERNS.some(pattern => pattern.test(text));
}

// Reference stress embeddings for semantic comparison
const STRESS_REFERENCE_PHRASES = [
    "That's not what I asked for",
    "You're not understanding me",
    "I already told you this",
    "This is wrong, try again",
    "You keep making the same mistake",
];

/** Cosine similarity between two vectors */
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/** Cached reference embeddings for stress detection */
let stressEmbeddingsCache: number[][] | null = null;
let stressEmbeddingsProvider: EmbeddingProvider | null = null;

async function detectStressSemantic(text: string, embeddingProvider: EmbeddingProvider): Promise<boolean> {
    try {
        // Build cache on first call
        if (!stressEmbeddingsCache || stressEmbeddingsProvider !== embeddingProvider) {
            stressEmbeddingsCache = await Promise.all(
                STRESS_REFERENCE_PHRASES.map(p => embeddingProvider.getEmbedding(p))
            );
            stressEmbeddingsProvider = embeddingProvider;
            logger.info(`[Mind] Cached ${stressEmbeddingsCache.length} stress reference embeddings`);
        }

        const textEmb = await embeddingProvider.getEmbedding(text);
        const maxSimilarity = Math.max(
            ...stressEmbeddingsCache.map(ref => cosineSimilarity(textEmb, ref))
        );

        return maxSimilarity > 0.75; // Threshold: 75% similarity
    } catch (err: any) {
        logger.warn(`[Mind] Semantic stress detection failed, falling back to regex: ${err.message}`);
        return detectStressRegex(text);
    }
}

export interface AgentInput {
    sessionKey: string;
    text: string;
    providerId?: string;
}

export interface AgentEvent {
    type: 'chunk' | 'done' | 'error';
    content?: string;
    error?: string;
}

export class AgentRunner {
    private sessions: SessionStore;
    private providers: Map<string, LLMProvider>;
    private defaultProviderId: string;
    private memory: MemoryIndex | null;
    private mindStore: MindStore | null;
    private toolRegistry: ToolRegistry | null;

    constructor(config: {
        sessions: SessionStore;
        providers: LLMProvider[];
        defaultProviderId: string;
        memory?: MemoryIndex | null;
        mindStore?: MindStore | null;
        toolRegistry?: ToolRegistry | null;
    }) {
        this.sessions = config.sessions;
        this.providers = new Map(config.providers.map(p => [p.id, p]));
        this.defaultProviderId = config.defaultProviderId;
        this.memory = config.memory || null;
        this.mindStore = config.mindStore || null;
        this.toolRegistry = config.toolRegistry || null;
    }

    async *run(input: AgentInput): AsyncGenerator<AgentEvent> {
        const targetProviderId = input.providerId || this.defaultProviderId;
        const provider = this.providers.get(targetProviderId);
        if (!provider) {
            yield { type: 'error', error: `Provider ${targetProviderId} not found` };
            return;
        }

        const session = this.sessions.getOrCreateSession(input.sessionKey, provider.id, provider.model);
        const history = this.sessions.getHistory(session.id);
        this.sessions.addMessage(session.id, 'user', input.text);

        // Auto-detect stress — try semantic detection first, fall back to regex
        if (this.mindStore) {
            let isStressed = detectStressRegex(input.text);

            // Semantic stress detection if embedding provider is available
            if (!isStressed && typeof provider.getEmbedding === 'function') {
                try {
                    isStressed = await detectStressSemantic(input.text, provider);
                } catch { /* regex fallback already handled */ }
            }

            if (isStressed) {
                try {
                    this.mindStore.addLog('stress', {
                        signal_type: 'correction',
                        context: `Auto-detected from user message: "${input.text.substring(0, 100)}${input.text.length > 100 ? '...' : ''}"`,
                        intensity: 3,
                    });
                    logger.info('[Mind] Auto-detected stress pattern');
                } catch (err: any) {
                    logger.warn(`[Mind] Failed to auto-log stress: ${err?.message || err}`);
                }
            }
        }

        const systemPrompt = await getSystemPrompt();
        const toolRegistry = this.toolRegistry;
        const tools = toolRegistry?.getAllDefinitions();
        logger.info(`Agent starting run. Available tools: ${tools?.length || 0}`);

        let messages: LLMMessage[] = history.map(m => ({
            role: m.role,
            content: m.content || '',
            toolCallId: m.toolCallId,
            toolCalls: m.metadata?.toolCalls
        }));
        messages.push({ role: 'user', content: input.text });

        // Token-aware history truncation — estimate ~4 chars/token, trim oldest messages
        const MAX_CONTEXT_TOKENS = Number(process.env.MAX_CONTEXT_TOKENS) || 100_000;
        messages = AgentRunner.truncateHistory(messages, MAX_CONTEXT_TOKENS);

        // RAG: augment context with relevant memories (graceful degradation — never blocks the response)
        if (this.memory) {
            try {
                const memories = await this.memory.query(input.text, 3);
                if (memories.length > 0) {
                    const memoryContext = memories
                        .map((m: any) => m.content)
                        .join('\n---\n');
                    messages.push({
                        role: 'user',
                        content: `[Relevant memories retrieved automatically — use if helpful]\n${memoryContext}`,
                    });
                    logger.info({ count: memories.length }, 'Injected RAG context into conversation');
                }
            } catch (err: any) {
                // Graceful degradation: RAG failure shouldn't block the conversation
                metrics.increment('rag.failures');
                logger.warn(`RAG context retrieval failed (continuing without): ${err.message}`);
            }
        }

        metrics.increment('agent.runs');
        const runStart = performance.now();
        let fullResponse = '';
        let iteration = 0;
        const MAX_ITERATIONS = 5;
        const TOKEN_BUDGET = Number(process.env.SESSION_TOKEN_BUDGET) || 500_000;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        try {
            while (iteration < MAX_ITERATIONS) {
                iteration++;
                let hasToolCall = false;

                for await (const event of provider.stream({ systemPrompt, messages, tools })) {
                    if (event.usage) {
                        totalInputTokens += event.usage.inputTokens;
                        totalOutputTokens += event.usage.outputTokens;
                    }

                    // Token budget guard — stop if we exceed the per-request budget
                    if (totalInputTokens + totalOutputTokens > TOKEN_BUDGET) {
                        logger.warn(`Token budget exceeded (${totalInputTokens + totalOutputTokens} > ${TOKEN_BUDGET}). Stopping.`);
                        yield { type: 'chunk', content: '\n\n[Token budget reached for this request]' };
                        // Record what we used and bail out
                        this.sessions.recordUsage(session.id, provider.id, session.model, totalInputTokens, totalOutputTokens);
                        if (fullResponse) {
                            this.sessions.addMessage(session.id, 'assistant', fullResponse + '\n\n[Token budget reached]');
                        }
                        yield { type: 'done' };
                        return;
                    }

                    if (event.type === 'text' && event.content) {
                        fullResponse += event.content;
                        yield { type: 'chunk', content: event.content };
                    } else if (event.type === 'tool_call' && event.toolCalls) {
                        hasToolCall = true;

                        // 1. Add current turn to history BEFORE executing tools
                        // Bundle accumulated text with the tool calls
                        const assistantTurn: LLMMessage = {
                            role: 'assistant',
                            content: fullResponse,
                            toolCalls: event.toolCalls
                        };
                        messages.push(assistantTurn);
                        this.sessions.addMessage(session.id, 'assistant', fullResponse, undefined, { toolCalls: event.toolCalls });

                        // 2. Execute all tools in this turn
                        for (const call of event.toolCalls) {
                            logger.info(`Agent calling tool: ${call.name} with ${JSON.stringify(call.args)}`);
                            try {
                                const toolContext = { sessionId: session.id, sessionKey: input.sessionKey };
                                const result = await toolRegistry!.execute(call.name, call.args, toolContext);
                                
                                // Special handling for dream tool - auto-process the analysis prompt
                                if (call.name === 'dream' && typeof result === 'object' && result !== null && 'analysis_prompt' in result) {
                                    logger.info('[Mind] Dream tool returned analysis prompt, processing automatically...');

                                    // Sanitize the dream prompt to prevent indirect prompt injection
                                    // The prompt is built from .mind/ log files which may contain user text
                                    let sanitizedPrompt = (result as any).analysis_prompt as string;
                                    const injectionPatterns = [
                                        /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
                                        /\byou\s+are\s+now\b/gi,
                                        /\bnew\s+instructions?\s*:/gi,
                                        /\bsystem\s*:\s*/gi,
                                        /\b(IMPORTANT|CRITICAL|URGENT)\s*:.*?(ignore|override|disregard)/gi,
                                        /<\/?system>/gi,
                                    ];
                                    for (const pattern of injectionPatterns) {
                                        sanitizedPrompt = sanitizedPrompt.replace(pattern, '[filtered]');
                                    }

                                    // Truncate to prevent context flooding (max 30k chars)
                                    const MAX_DREAM_PROMPT = 30_000;
                                    if (sanitizedPrompt.length > MAX_DREAM_PROMPT) {
                                        sanitizedPrompt = sanitizedPrompt.slice(0, MAX_DREAM_PROMPT) + '\n\n...[dream logs truncated for token budget]';
                                    }

                                    // Inject as tool result (not user message) to maintain proper role boundaries
                                    const wrappedPrompt = `[Dream Phase Analysis — Auto-generated from .mind/ logs]\n${sanitizedPrompt}\n[End Dream Phase Data]`;
                                    messages.push({ role: 'tool', content: wrappedPrompt, toolCallId: call.name });
                                    this.sessions.addMessage(session.id, 'tool', wrappedPrompt, call.name);
                                    continue; // Skip normal tool result handling
                                }
                                
                                const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

                                messages.push({ role: 'tool', content: resultStr, toolCallId: call.name });
                                this.sessions.addMessage(session.id, 'tool', resultStr, call.name);
                                logger.info(`Tool ${call.name} result: ${resultStr}`);
                            } catch (err: any) {
                                const errorMsg = `Tool Error: ${err.message}`;
                                logger.error(`Tool execution failed: ${errorMsg}`);
                                messages.push({ role: 'tool', content: errorMsg, toolCallId: call.name });
                                this.sessions.addMessage(session.id, 'tool', errorMsg, call.name);
                            }
                        }

                        // Reset fullResponse for the next text generation (post-tool)
                        fullResponse = '';
                    } else if (event.type === 'error') {
                        yield { type: 'error', error: event.error };
                        return;
                    }
                }

                if (!hasToolCall) break;
            }

            // Record usage after the loop finish
            if (totalInputTokens > 0 || totalOutputTokens > 0) {
                this.sessions.recordUsage(session.id, provider.id, session.model, totalInputTokens, totalOutputTokens);
                logger.info(`Session ${session.id} used ${totalInputTokens + totalOutputTokens} tokens.`);
            }

            if (fullResponse) {
                this.sessions.addMessage(session.id, 'assistant', fullResponse);
            }

            metrics.observe('agent.run_ms', performance.now() - runStart);
            yield { type: 'done' };
        } catch (err: any) {
            metrics.increment('agent.errors');
            metrics.observe('agent.run_ms', performance.now() - runStart);
            yield { type: 'error', error: err.message };
        }
    }

    /** Estimate token count for a message (~4 chars per token) */
    private static estimateTokens(msg: LLMMessage): number {
        let chars = (msg.content || '').length;
        if (msg.toolCalls) {
            chars += JSON.stringify(msg.toolCalls).length;
        }
        return Math.ceil(chars / 4);
    }

    /** Truncate history from the front (oldest messages) to fit within token budget */
    static truncateHistory(messages: LLMMessage[], maxTokens: number): LLMMessage[] {
        let totalTokens = messages.reduce((sum, m) => sum + AgentRunner.estimateTokens(m), 0);
        if (totalTokens <= maxTokens) return messages;

        // Always keep the last message (current user input) and first 2 messages (initial context)
        const keep = 2;
        let trimmed = [...messages];
        while (totalTokens > maxTokens && trimmed.length > keep + 1) {
            const removed = trimmed.splice(keep, 1)[0];
            totalTokens -= AgentRunner.estimateTokens(removed);
        }

        if (trimmed.length < messages.length) {
            logger.info(`Truncated history from ${messages.length} to ${trimmed.length} messages (~${totalTokens} estimated tokens)`);
        }

        return trimmed;
    }
}
