/**
 * Authentication utilities — HMAC-based token generation and validation
 * with expiration support for the HTTP API.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours default

export interface TokenPayload {
  /** Issued-at timestamp (ms) */
  iat: number;
  /** Expiration timestamp (ms) */
  exp: number;
}

/**
 * Generate a time-limited HMAC token from the admin password.
 * Format: base64(JSON payload).base64(HMAC signature)
 */
export function generateToken(secret: string, ttlMs: number = TOKEN_TTL_MS): string {
  const now = Date.now();
  const payload: TokenPayload = {
    iat: now,
    exp: now + ttlMs,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payloadB64).digest('base64url');

  return `${payloadB64}.${signature}`;
}

/**
 * Validate a token. Returns the payload if valid, null otherwise.
 */
export function validateToken(token: string, secret: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;

  // Verify signature using timing-safe comparison
  const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('base64url');

  try {
    const sigBuf = Buffer.from(signature, 'base64url');
    const expectedBuf = Buffer.from(expectedSig, 'base64url');

    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
  } catch {
    return null;
  }

  // Parse and check expiration
  try {
    const payload: TokenPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

    if (!payload.exp || Date.now() > payload.exp) {
      return null; // Token expired
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Middleware-compatible auth check.
 * Accepts either:
 *   - Bearer <HMAC token>  (preferred, time-limited)
 *   - Bearer <raw admin password>  (backwards compatible)
 */
export function verifyAuthorization(authHeader: string | undefined, adminPassword: string): boolean {
  if (!authHeader) return false;

  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return false;

  // Try HMAC token first
  if (token.includes('.')) {
    const payload = validateToken(token, adminPassword);
    if (payload) return true;
  }

  // Fall back to raw password comparison (timing-safe)
  try {
    const tokenBuf = Buffer.from(token);
    const passwordBuf = Buffer.from(adminPassword);

    if (tokenBuf.length !== passwordBuf.length) return false;
    return timingSafeEqual(tokenBuf, passwordBuf);
  } catch {
    return false;
  }
}
