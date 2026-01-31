import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer | null {
    const hexKey = process.env.WHATSAPP_AUTH_ENCRYPTION_KEY;
    if (!hexKey || hexKey.length !== 64) {
        return null;
    }
    return Buffer.from(hexKey, 'hex');
}

function encrypt(data: string, key: Buffer): Buffer {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: [IV (16)] [AuthTag (16)] [Ciphertext (...)]
    return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(data: Buffer, key: Buffer): string {
    const iv = data.subarray(0, IV_LENGTH);
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final('utf8');
}

/**
 * Drop-in replacement for Baileys' useMultiFileAuthState that encrypts
 * all auth files at rest using AES-256-GCM.
 *
 * If WHATSAPP_AUTH_ENCRYPTION_KEY is not set, falls back to plaintext
 * (same as the original useMultiFileAuthState).
 */
export async function useEncryptedAuthState(dir: string) {
    const key = getEncryptionKey();
    if (!key) {
        logger.warn('WHATSAPP_AUTH_ENCRYPTION_KEY not set — WhatsApp auth stored in plaintext.');
        // Fall back to Baileys' built-in
        const { useMultiFileAuthState } = await import('@whiskeysockets/baileys');
        return useMultiFileAuthState(dir);
    }

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const readEncrypted = (filePath: string): any | null => {
        if (!fs.existsSync(filePath)) return null;
        try {
            const raw = fs.readFileSync(filePath);
            const json = decrypt(raw, key);
            return JSON.parse(json, bufferReviver);
        } catch (err: any) {
            logger.error(`Failed to decrypt ${filePath}: ${err.message}`);
            return null;
        }
    };

    const writeEncrypted = (filePath: string, data: any): void => {
        const json = JSON.stringify(data, bufferReplacer);
        const encrypted = encrypt(json, key);
        fs.writeFileSync(filePath, encrypted);
    };

    const credsFile = path.join(dir, 'creds.enc');
    let creds = readEncrypted(credsFile) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: (type: string, ids: string[]) => {
                    const data: Record<string, any> = {};
                    for (const id of ids) {
                        const filePath = path.join(dir, `${type}-${id}.enc`);
                        const value = readEncrypted(filePath);
                        if (value) {
                            data[id] = value;
                        }
                    }
                    return data;
                },
                set: (data: Record<string, Record<string, any>>) => {
                    for (const [type, entries] of Object.entries(data)) {
                        for (const [id, value] of Object.entries(entries)) {
                            const filePath = path.join(dir, `${type}-${id}.enc`);
                            if (value) {
                                writeEncrypted(filePath, value);
                            } else if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                            }
                        }
                    }
                },
            },
        },
        saveCreds: () => {
            writeEncrypted(credsFile, creds);
        },
    };
}

// Baileys uses Buffers in auth state — these need special JSON handling
function bufferReplacer(_key: string, value: any) {
    if (Buffer.isBuffer(value) || value?.type === 'Buffer') {
        return { __buffer: true, data: Buffer.from(value?.data || value).toString('base64') };
    }
    return value;
}

function bufferReviver(_key: string, value: any) {
    if (value?.__buffer) {
        return Buffer.from(value.data, 'base64');
    }
    return value;
}

function initAuthCreds() {
    // Baileys will populate this on first connect
    return {};
}
