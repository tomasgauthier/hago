/**
 * Voice message transcription via Whisper-compatible API.
 * Supports OpenAI Whisper API and local whisper servers.
 */

import { logger } from './logger.js';

const WHISPER_API_URL = process.env.WHISPER_API_URL || 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_API_KEY = process.env.OPENAI_API_KEY || '';

export async function transcribeVoice(audioBuffer: Buffer, language?: string): Promise<string | null> {
    if (!WHISPER_API_KEY && WHISPER_API_URL.includes('openai.com')) {
        logger.warn('[Voice] No OpenAI API key configured for Whisper transcription');
        return null;
    }

    try {
        const formData = new FormData();
        const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
        formData.append('file', blob, 'voice.ogg');
        formData.append('model', 'whisper-1');
        if (language) formData.append('language', language);

        const response = await fetch(WHISPER_API_URL, {
            method: 'POST',
            headers: {
                ...(WHISPER_API_KEY ? { 'Authorization': `Bearer ${WHISPER_API_KEY}` } : {}),
            },
            body: formData,
        });

        if (!response.ok) {
            logger.error(`[Voice] Whisper API error: ${response.status} ${response.statusText}`);
            return null;
        }

        const result = await response.json() as { text: string };
        logger.info(`[Voice] Transcribed ${audioBuffer.length} bytes → "${result.text.substring(0, 50)}..."`);
        return result.text;
    } catch (err: any) {
        logger.error(`[Voice] Transcription failed: ${err.message}`);
        return null;
    }
}
