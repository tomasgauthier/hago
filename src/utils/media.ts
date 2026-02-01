/**
 * Media processing utilities for voice/image handling.
 */

import { logger } from './logger.js';

/**
 * Download a file from Telegram using the Bot API.
 * Returns the file as a Buffer.
 */
export async function downloadTelegramFile(token: string, fileId: string): Promise<Buffer | null> {
    try {
        // Get file path from Telegram
        const fileInfo = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
        const fileData = await fileInfo.json() as { ok: boolean; result?: { file_path: string } };

        if (!fileData.ok || !fileData.result?.file_path) {
            logger.error('[Media] Failed to get file path from Telegram');
            return null;
        }

        // Download the file
        const fileUrl = `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`;
        const response = await fetch(fileUrl);
        if (!response.ok) {
            logger.error(`[Media] Failed to download file: ${response.status}`);
            return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (err: any) {
        logger.error(`[Media] Download failed: ${err.message}`);
        return null;
    }
}

/**
 * Convert an image buffer to a base64 data URL for multimodal LLM input.
 */
export function imageToDataUrl(buffer: Buffer, mimeType: string = 'image/jpeg'): string {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}
