import { logger } from '../utils/logger.js';

export interface RouteRule {
    /** Provider ID to route to */
    provider: string;
    /** Regex patterns — if any match the message, this route is selected */
    patterns: string[];
}

/** Cost tier definitions for cost-aware routing */
export interface ProviderCostTier {
    providerId: string;
    costPer1kTokens: number; // USD per 1k tokens (blended input/output)
}

export interface RouterConfig {
    defaultProvider: string;
    routes: RouteRule[];
    /** Provider cost tiers for cost-aware routing (optional) */
    costTiers?: ProviderCostTier[];
    /** Fallback provider for simple/short messages to save cost */
    cheapProvider?: string;
    /** Minimum message length (chars) to use the expensive default provider */
    complexityThreshold?: number;
}

export class AgentRouter {
    private defaultProvider: string;
    private routes: { provider: string; compiled: RegExp[] }[];
    private cheapProvider: string | null;
    private complexityThreshold: number;

    constructor(config: RouterConfig) {
        this.defaultProvider = config.defaultProvider;
        this.routes = config.routes.map(r => ({
            provider: r.provider,
            compiled: r.patterns.map(p => new RegExp(p, 'i')),
        }));
        this.cheapProvider = config.cheapProvider || null;
        this.complexityThreshold = config.complexityThreshold || 100;
        logger.info(`Agent router initialized with ${this.routes.length} route(s), default: ${this.defaultProvider}${this.cheapProvider ? `, cheap: ${this.cheapProvider}` : ''}`);
    }

    /**
     * Given a user message, return the provider ID that should handle it.
     * Routes by pattern first, then by cost-awareness (short/simple → cheap provider).
     */
    resolve(text: string): string {
        // Pattern-based routing takes priority
        for (const route of this.routes) {
            if (route.compiled.some(re => re.test(text))) {
                logger.info(`Routed to provider "${route.provider}" based on pattern match`);
                return route.provider;
            }
        }

        // Cost-aware routing: short/simple messages go to cheaper provider
        if (this.cheapProvider && text.length < this.complexityThreshold) {
            logger.info(`Cost-aware route: short message (${text.length} chars) → cheap provider "${this.cheapProvider}"`);
            return this.cheapProvider;
        }

        return this.defaultProvider;
    }
}
