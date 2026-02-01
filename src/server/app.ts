import { Hono } from 'hono';
import { logger as honoLogger } from 'hono/logger';
import { cors } from 'hono/cors';
import { streamText } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import { AppContainer } from '../container.js';
import { saveConfig } from '../config/load.js';
import { AppConfigSchema } from '../config/schema.js';
import { IDENTITY } from '../agent/identity.js';
import { logger } from '../utils/logger.js';
import { verifyAuthorization, generateToken } from '../utils/auth.js';
import { AuditLog } from '../utils/audit.js';

// ── Rate Limiter (in-memory, per-IP) ────────────────────────────────
interface RateBucket {
    count: number;
    resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();
const RATE_WINDOW_MS = 60_000;      // 1 minute window
const RATE_MAX_REQUESTS = 30;       // max requests per window

function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const bucket = rateBuckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
        rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
        return false;
    }
    bucket.count++;
    return bucket.count > RATE_MAX_REQUESTS;
}

// Cleanup stale buckets every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of rateBuckets) {
        if (now > bucket.resetAt) rateBuckets.delete(ip);
    }
}, 5 * 60_000).unref();

// ── Daily Cost Ceiling ──────────────────────────────────────────────
const DAILY_COST_CEILING_USD = parseFloat(process.env.DAILY_COST_CEILING || '5.00');

function getDailyCost(container: AppContainer): number {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const row = container.sessions.db.prepare(
        'SELECT COALESCE(SUM(cost), 0) as dailyCost FROM usage WHERE created_at >= ?'
    ).get(startOfDay.getTime()) as any;
    return row.dailyCost;
}

function getClientIp(c: any): string {
    // Only trust proxy headers if TRUST_PROXY is set (e.g. behind nginx/cloudflare)
    if (process.env.TRUST_PROXY === 'true') {
        return c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
            || c.req.header('x-real-ip')
            || '127.0.0.1';
    }
    return '127.0.0.1';
}

export function createServer(container: AppContainer) {
    const app = new Hono();
    const audit = new AuditLog(container.sessions.db);

    app.use('*', honoLogger());
    app.use('*', cors({
        origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
        credentials: true,
    }));

    // ── Security headers ─────────────────────────────────────────────
    app.use('*', async (c, next) => {
        await next();
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('X-Frame-Options', 'DENY');
        c.header('X-XSS-Protection', '1; mode=block');
        c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
        c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        // Only set strict CSP on API responses, not on admin static files
        if (c.req.path.startsWith('/api/')) {
            c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        }
    });

    // Rate limiting middleware for all routes
    app.use('*', async (c, next) => {
        const ip = getClientIp(c);
        if (isRateLimited(ip)) {
            return c.json({ error: 'Too many requests. Try again later.' }, 429);
        }
        await next();
    });

    // Security: ADMIN_PASSWORD is REQUIRED. If not set, all API/admin routes are locked.
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
        logger.warn('ADMIN_PASSWORD is not set — all API and admin routes will return 403. Set it in .env.');
    }

    // Auth middleware for /api/* routes — uses HMAC token validation with raw password fallback
    app.use('/api/*', async (c, next) => {
        if (!adminPassword) {
            return c.json({ error: 'Server misconfigured: ADMIN_PASSWORD not set' }, 403);
        }

        const authHeader = c.req.header('Authorization');
        if (!verifyAuthorization(authHeader, adminPassword)) {
            const ip = getClientIp(c);
            audit.log({
                action: 'auth_failure',
                detail: `Failed auth attempt on ${c.req.method} ${c.req.path}`,
                ip,
            });
            return c.json({ error: 'Unauthorized' }, 401);
        }

        await next();
    });

    // ── Token endpoint — exchange admin password for time-limited HMAC token ──
    app.post('/auth/token', async (c) => {
        if (!adminPassword) {
            return c.json({ error: 'Server misconfigured: ADMIN_PASSWORD not set' }, 403);
        }

        const body = await c.req.json().catch(() => ({}));
        const { password } = body as { password?: string };

        const passwordValid = password && (() => {
            try {
                const a = Buffer.from(String(password));
                const b = Buffer.from(adminPassword);
                if (a.length !== b.length) return false;
                const { timingSafeEqual } = require('node:crypto');
                return timingSafeEqual(a, b);
            } catch { return false; }
        })();
        if (!passwordValid) {
            const ip = getClientIp(c);
            audit.log({
                action: 'auth_failure',
                detail: 'Failed token exchange attempt',
                ip,
            });
            return c.json({ error: 'Invalid password' }, 401);
        }

        const ttl = 24 * 60 * 60 * 1000; // 24h
        const token = generateToken(adminPassword, ttl);

        return c.json({
            token,
            expires_in: ttl / 1000,
            token_type: 'Bearer',
        });
    });

    // Admin static files are served without auth — the UI itself is just HTML/JS/CSS.
    // All sensitive data is protected at the API layer above.
    app.get('/admin', (c) => {
        return c.redirect('/admin/index.html');
    });

    app.use('/admin/*', serveStatic({ root: 'src/server/public' }));

    // Public routes (no auth needed)
    app.get('/health', (c) => c.json({ status: 'ok', version: '2.0.0' }));

    // Identity is behind /api/ auth — exposes persona and principles
    app.get('/api/identity', (c) => c.json(IDENTITY));

    app.get('/api/usage', (c) => {
        return c.json(container.sessions.getTotalCosts());
    });

    // Audit log endpoint
    app.get('/api/audit', (c) => {
        const action = c.req.query('action');
        const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);

        if (action) {
            return c.json(audit.getByAction(action as any, limit));
        }
        return c.json(audit.getRecent(limit));
    });

    // Config Management
    app.get('/api/config', (c) => {

        // Redact sensitive info
        const safeConfig = JSON.parse(JSON.stringify(container.config));
        safeConfig.providers.forEach((p: any) => {
            if (p.apiKey) p.apiKey = '********';
            if (p.googleApiKey) p.googleApiKey = '********';
        });
        if (safeConfig.channels.telegram?.token) safeConfig.channels.telegram.token = '********';

        return c.json(safeConfig);
    });

    app.post('/api/config', async (c) => {
        const newConfig = await c.req.json();

        // Merge with existing secrets to avoid overwriting with '********'
        const currentConfig = container.config;
        if (Array.isArray(newConfig.providers)) {
            newConfig.providers.forEach((p: any, i: number) => {
                const current = currentConfig.providers[i];
                if (current) {
                    if (p.apiKey === '********') p.apiKey = current.apiKey;
                    if (p.googleApiKey === '********') p.googleApiKey = current.googleApiKey;
                }
            });
        }
        if (newConfig.channels?.telegram?.token === '********') {
            newConfig.channels.telegram.token = currentConfig.channels.telegram?.token;
        }

        try {
            // Validate against Zod schema BEFORE applying — reject malformed configs
            const validated = AppConfigSchema.parse(newConfig);

            saveConfig(validated);
            Object.assign(container.config, validated);

            audit.log({
                action: 'config_update',
                detail: 'Configuration updated via API',
                ip: getClientIp(c),
            });

            // Hot-reload channel configurations
            if (validated.channels.telegram) {
                container.channels.updateChannelConfig('telegram', validated.channels.telegram);
            }

            return c.json({ success: true });
        } catch (err: any) {
            return c.json({ error: `Config validation failed: ${err.message}` }, 400);
        }
    });

    // Daily cost ceiling — exposed as a read-only endpoint
    app.get('/api/daily-cost', (c) => {
        const spent = getDailyCost(container);
        return c.json({
            spent_usd: spent.toFixed(4),
            ceiling_usd: DAILY_COST_CEILING_USD.toFixed(2),
            remaining_usd: Math.max(0, DAILY_COST_CEILING_USD - spent).toFixed(4),
            blocked: spent >= DAILY_COST_CEILING_USD,
        });
    });

    app.post('/api/chat', async (c) => {
        const body = await c.req.json();
        const { sessionKey, text } = body;

        if (!sessionKey || !text) {
            return c.json({ error: 'Missing sessionKey or text' }, 400);
        }

        // Enforce daily cost ceiling
        const dailyCost = getDailyCost(container);
        if (dailyCost >= DAILY_COST_CEILING_USD) {
            logger.warn(`Daily cost ceiling reached: $${dailyCost.toFixed(4)} >= $${DAILY_COST_CEILING_USD.toFixed(2)}`);
            return c.json({
                error: `Daily cost ceiling of $${DAILY_COST_CEILING_USD.toFixed(2)} reached. Spent today: $${dailyCost.toFixed(4)}. ` +
                       `Set DAILY_COST_CEILING in .env to adjust.`
            }, 429);
        }

        return streamText(c, async (stream) => {
            try {
                await container.channels.runQueued(
                    sessionKey,
                    text,
                    async () => { /* No special completion action needed for API */ },
                    async (chunk) => {
                        await stream.write(chunk);
                    }
                );
            } catch (err: any) {
                logger.error(`Stream error: ${err.message}`);
                await stream.write(`\nStream Error: ${err.message}`);
            }
        });
    });

    app.get('/api/messages', (c) => {
        const sessionKey = c.req.query('sessionKey');
        if (!sessionKey) return c.json({ error: 'Missing sessionKey' }, 400);

        const session = container.sessions.getOrCreateSession(sessionKey, container.config.defaultProvider, 'unknown');
        const history = container.sessions.getHistory(session.id, 50);
        return c.json(history);
    });

    app.get('/api/sessions', (c) => {
        return c.json({ sessions: [] });
    });

    // Expose audit log instance for other modules
    (container as any).audit = audit;

    return app;
}
