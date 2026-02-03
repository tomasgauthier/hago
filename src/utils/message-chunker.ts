/**
 * Message Chunker Utility
 *
 * Splits long text into chunks suitable for messaging platforms like Telegram/WhatsApp.
 * Telegram limit: 4096 characters
 * WhatsApp limit: ~4096 characters (practical)
 */

export interface ChunkerOptions {
    maxLength?: number;
    preserveMarkdown?: boolean;
    separator?: string;
    sanitizeMarkdown?: boolean;
}

/**
 * Sanitize markdown for Telegram to prevent parsing errors
 * Fixes unmatched markdown markers that break Telegram's Markdown parser
 */
function sanitizeTelegramMarkdown(text: string): string {
    let result = text;

    // Fix unmatched asterisks - count and balance them
    const asteriskCount = (result.match(/\*/g) || []).length;
    if (asteriskCount % 2 !== 0) {
        // Odd number of asterisks - find and escape standalone ones
        // This is a simple approach: escape asterisks that aren't part of ** or * pairs
        let inBold = false;
        let inItalic = false;
        result = result.split('').map((char, i, arr) => {
            if (char === '*') {
                const prev = arr[i - 1];
                const next = arr[i + 1];

                // Check if it's part of **
                if (next === '*' && !inBold) {
                    inBold = true;
                    return char;
                } else if (prev === '*' && inBold) {
                    inBold = false;
                    return char;
                }

                // Toggle italic state
                inItalic = !inItalic;
                return char;
            }
            return char;
        }).join('');
    }

    // Fix unmatched underscores - same logic
    const underscoreCount = (result.match(/_/g) || []).length;
    if (underscoreCount % 2 !== 0) {
        // Escape the last underscore
        const lastIndex = result.lastIndexOf('_');
        if (lastIndex !== -1) {
            result = result.substring(0, lastIndex) + '\\_' + result.substring(lastIndex + 1);
        }
    }

    // Remove problematic separators that might break parsing
    result = result.replace(/^---$/gm, '━━━━━━━━');  // Replace --- with unicode line

    return result;
}

const DEFAULT_MAX_LENGTH = 3800; // Leave room for markdown and safety margin

/**
 * Split text into chunks, respecting markdown formatting and message limits
 */
export function chunkMessage(text: string, options: ChunkerOptions = {}): string[] {
    const maxLength = options.maxLength || DEFAULT_MAX_LENGTH;
    const preserveMarkdown = options.preserveMarkdown ?? true;
    const separator = options.separator || '\n\n';

    // If text is short enough, return as-is
    if (text.length <= maxLength) {
        return [text];
    }

    const chunks: string[] = [];

    // Split by double newlines first (paragraphs)
    const paragraphs = text.split(separator);
    let currentChunk = '';

    for (const paragraph of paragraphs) {
        // If a single paragraph is too long, split it further
        if (paragraph.length > maxLength) {
            // Save current chunk if not empty
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }

            // Split long paragraph by sentences
            const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
            for (const sentence of sentences) {
                if (sentence.length > maxLength) {
                    // Last resort: hard split
                    const words = sentence.split(' ');
                    for (const word of words) {
                        if ((currentChunk + ' ' + word).length > maxLength) {
                            chunks.push(currentChunk.trim());
                            currentChunk = word;
                        } else {
                            currentChunk += (currentChunk ? ' ' : '') + word;
                        }
                    }
                } else if ((currentChunk + sentence).length > maxLength) {
                    chunks.push(currentChunk.trim());
                    currentChunk = sentence;
                } else {
                    currentChunk += (currentChunk ? ' ' : '') + sentence;
                }
            }
            continue;
        }

        // Check if adding this paragraph would exceed the limit
        const testChunk = currentChunk + (currentChunk ? separator : '') + paragraph;

        if (testChunk.length > maxLength) {
            // Save current chunk and start a new one
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }
            currentChunk = paragraph;
        } else {
            currentChunk = testChunk;
        }
    }

    // Add the last chunk
    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

/**
 * Split long content into thread-style messages
 * Adds thread indicators like [1/3], [2/3], etc.
 */
export function createThread(text: string, options: ChunkerOptions = {}): string[] {
    const sanitize = options.sanitizeMarkdown ?? true;
    const chunks = chunkMessage(text, options);

    if (chunks.length === 1) {
        return sanitize ? [sanitizeTelegramMarkdown(chunks[0])] : chunks;
    }

    // Add thread indicators
    return chunks.map((chunk, index) => {
        const sanitized = sanitize ? sanitizeTelegramMarkdown(chunk) : chunk;
        const threadIndicator = `🧵 [${index + 1}/${chunks.length}]`;
        return `${threadIndicator}\n\n${sanitized}`;
    });
}

/**
 * Create a thread from structured sections
 * Each section becomes a message in the thread
 */
export function createStructuredThread(sections: { title?: string; content: string }[], sanitize: boolean = true): string[] {
    const messages: string[] = [];

    for (const section of sections) {
        let message = '';

        if (section.title) {
            message = `**${section.title}**\n\n${section.content}`;
        } else {
            message = section.content;
        }

        // If this message is too long, chunk it
        const chunks = chunkMessage(message, { maxLength: DEFAULT_MAX_LENGTH });
        messages.push(...chunks);
    }

    // Sanitize markdown if requested
    const processed = sanitize ? messages.map(m => sanitizeTelegramMarkdown(m)) : messages;

    // Add thread indicators if multiple messages
    if (processed.length > 1) {
        return processed.map((msg, idx) => `🧵 [${idx + 1}/${processed.length}]\n\n${msg}`);
    }

    return processed;
}
