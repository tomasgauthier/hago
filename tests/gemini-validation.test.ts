/**
 * Tests for Gemini message history validation logic.
 * Validates the ordering constraints that caused 400 errors.
 */
import { describe, it, expect } from 'vitest';

// Extract the validation logic as a pure function for testing
function validateGeminiContents(contents: any[]): any[] {
    const validated: any[] = [];

    for (let i = 0; i < contents.length; i++) {
        const c = contents[i];
        const hasFnCall = c.parts?.some((p: any) => p.functionCall);
        const isFnResponse = c.role === 'function';

        if (hasFnCall) {
            const next = contents[i + 1];
            if (!next || next.role !== 'function') {
                continue; // Skip orphaned function call
            }
            validated.push(c);
            validated.push(next);
            i++;
            continue;
        }

        if (isFnResponse) {
            const prev = validated[validated.length - 1];
            if (!prev || !prev.parts?.some((p: any) => p.functionCall)) {
                continue; // Skip orphaned function response
            }
            validated.push(c);
            continue;
        }

        // Merge consecutive same-role turns
        const prev = validated[validated.length - 1];
        if (prev && prev.role === c.role) {
            prev.parts.push(...c.parts);
            continue;
        }

        validated.push(c);
    }

    // Strip leading non-user turns
    while (validated.length > 0 && validated[0].role !== 'user') {
        validated.shift();
    }

    return validated;
}

describe('Gemini message validation', () => {
    it('keeps valid user → model alternation', () => {
        const contents = [
            { role: 'user', parts: [{ text: 'hello' }] },
            { role: 'model', parts: [{ text: 'hi there' }] },
        ];
        const result = validateGeminiContents(contents);
        expect(result).toHaveLength(2);
    });

    it('merges consecutive user turns (RAG injection)', () => {
        const contents = [
            { role: 'user', parts: [{ text: 'what is X?' }] },
            { role: 'user', parts: [{ text: '[memory context]' }] },
        ];
        const result = validateGeminiContents(contents);
        expect(result).toHaveLength(1);
        expect(result[0].parts).toHaveLength(2);
    });

    it('strips leading model turn', () => {
        const contents = [
            { role: 'model', parts: [{ text: 'orphaned' }] },
            { role: 'user', parts: [{ text: 'hello' }] },
        ];
        const result = validateGeminiContents(contents);
        expect(result).toHaveLength(1);
        expect(result[0].role).toBe('user');
    });

    it('keeps paired function call + response', () => {
        const contents = [
            { role: 'user', parts: [{ text: 'search for X' }] },
            { role: 'model', parts: [{ functionCall: { name: 'search', args: {} } }] },
            { role: 'function', parts: [{ functionResponse: { name: 'search', response: { content: 'result' } } }] },
            { role: 'model', parts: [{ text: 'I found...' }] },
        ];
        const result = validateGeminiContents(contents);
        expect(result).toHaveLength(4);
    });

    it('skips orphaned function call without response', () => {
        const contents = [
            { role: 'user', parts: [{ text: 'test' }] },
            { role: 'model', parts: [{ functionCall: { name: 'tool', args: {} } }] },
            { role: 'user', parts: [{ text: 'next message' }] },
        ];
        const result = validateGeminiContents(contents);
        expect(result).toHaveLength(1);
        expect(result[0].parts).toHaveLength(2); // Merged user turns
    });

    it('skips orphaned function response without call', () => {
        const contents = [
            { role: 'user', parts: [{ text: 'test' }] },
            { role: 'function', parts: [{ functionResponse: { name: 'tool', response: {} } }] },
        ];
        const result = validateGeminiContents(contents);
        expect(result).toHaveLength(1);
        expect(result[0].role).toBe('user');
    });
});
