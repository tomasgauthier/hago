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

export interface LLMProvider {
    id: string;
    stream(params: {
        systemPrompt: string;
        messages: LLMMessage[];
        tools?: any[]; // Unified tool definitions
    }): AsyncGenerator<StreamEvent>;
    getEmbedding(text: string): Promise<number[]>;
}
