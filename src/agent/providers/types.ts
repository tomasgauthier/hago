export interface LLMMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    toolCallId?: string; // Retained for single tool response tracking
    toolCalls?: ToolCall[]; // New: multiple calls in one turn
}

export interface ToolCall {
    id: string;
    name: string;
    args: any;
}

export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}

export interface StreamEvent {
    type: 'text' | 'done' | 'error' | 'tool_call';
    content?: string;
    error?: string;
    toolCalls?: ToolCall[];
    usage?: TokenUsage;
}

/** Core chat completion interface — all providers must implement this */
export interface ChatProvider {
    id: string;
    model: string;
    stream(params: {
        systemPrompt: string;
        messages: LLMMessage[];
        tools?: any[];
    }): AsyncGenerator<StreamEvent>;
}

/** Embedding-capable provider — only required for RAG */
export interface EmbeddingProvider {
    id: string;
    getEmbedding(text: string): Promise<number[]>;
}

/**
 * Combined interface for backwards compatibility.
 * Providers that support both chat and embedding implement this.
 */
export interface LLMProvider extends ChatProvider, EmbeddingProvider {}
