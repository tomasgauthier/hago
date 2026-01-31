export interface InboundMessage {
    id: string;
    sessionKey: string;
    text: string;
    channelId: string;
    timestamp?: number; // Unix epoch seconds (message send time)
    type?: string; // Message type (text, callback_query, poll_answer, reaction, etc.)
    
    // Extended properties for rich message types
    callbackData?: string;
    pollAnswers?: number[];
    reactions?: string[];
    mediaType?: string;
    fileId?: string;
    caption?: string;
    voiceDuration?: number;
}

export interface OutboundMessage {
    text: string;
    sessionKey: string;
}

export interface Channel {
    id: string;
    start(): Promise<void>;
    stop(): Promise<void>;
    sendMessage(msg: OutboundMessage): Promise<void>;
    onMessage(handler: (msg: InboundMessage) => void): void;
    updateConfig?(config: any): void;
}
