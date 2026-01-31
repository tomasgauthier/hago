import { SessionStore } from '../sessions/store.js';
import { LLMProvider, LLMMessage } from './providers/types.js';
import { logger } from '../utils/logger.js';
import { getSystemPrompt } from './identity.js';

// Stress detection patterns
const STRESS_PATTERNS = [
    /no[,\s]+(that'?s?\s+)?(wrong|incorrect|not what i meant)/i,
    /actually[,\s]+/i,
    /i (already )?told you/i,
    /you'?re not listening/i,
    /that'?s not what i (asked|said|meant)/i,
    /why (did you|would you)/i,
];

function detectStress(text: string): boolean {
    return STRESS_PATTERNS.some(pattern => pattern.test(text));
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

    constructor(config: {
        sessions: SessionStore;
        providers: LLMProvider[];
        defaultProviderId: string;
    }) {
        this.sessions = config.sessions;
        this.providers = new Map(config.providers.map(p => [p.id, p]));
        this.defaultProviderId = config.defaultProviderId;
    }

    async *run(input: AgentInput): AsyncGenerator<AgentEvent> {
        const targetProviderId = input.providerId || this.defaultProviderId;
        const provider = this.providers.get(targetProviderId);
        if (!provider) {
            yield { type: 'error', error: `Provider ${targetProviderId} not found` };
            return;
        }

        const session = this.sessions.getOrCreateSession(input.sessionKey, provider.id, 'gemini-1.5-flash');
        const history = this.sessions.getHistory(session.id);
        this.sessions.addMessage(session.id, 'user', input.text);

        // Auto-detect stress patterns in user message
        if (detectStress(input.text)) {
            const toolRegistry = (global as any).container?.tools;
            if (toolRegistry) {
                try {
                    await toolRegistry.execute('log_stress', {
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
        const toolRegistry = (global as any).container?.tools; // Temporary access to tools, could be injected better
        const tools = toolRegistry?.getAllDefinitions();
        logger.info(`Agent starting run. Available tools: ${tools?.length || 0}`);

        const messages: LLMMessage[] = history.map(m => ({
            role: m.role,
            content: m.content || '',
            toolCallId: m.toolCallId,
            toolCalls: m.metadata?.toolCalls
        }));
        messages.push({ role: 'user', content: input.text });

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
                                const result = await toolRegistry.execute(call.name, call.args, toolContext);
                                
                                // Special handling for dream tool - auto-process the analysis prompt
                                if (call.name === 'dream' && typeof result === 'object' && result.analysis_prompt) {
                                    logger.info('[Mind] Dream tool returned analysis prompt, processing automatically...');
                                    
                                    // Inject the analysis prompt as a new user message
                                    const dreamAnalysisMsg: LLMMessage = { role: 'user', content: result.analysis_prompt };
                                    messages.push(dreamAnalysisMsg);
                                    
                                    // Mark that we processed it
                                    const resultStr = JSON.stringify({ 
                                        ...result, 
                                        analysis_prompt: '[Analysis prompt processed automatically]' 
                                    });
                                    messages.push({ role: 'tool', content: resultStr, toolCallId: call.name });
                                    this.sessions.addMessage(session.id, 'tool', resultStr, call.name);
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

            yield { type: 'done' };
        } catch (err: any) {
            yield { type: 'error', error: err.message };
        }
    }
}
