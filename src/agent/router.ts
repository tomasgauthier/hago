import { logger } from '../utils/logger.js';

export interface RouteRule {
    /** Provider ID to route to */
    provider: string;
    /** Regex patterns — if any match the message, this route is selected */
    patterns: string[];
}

export interface RouterConfig {
    defaultProvider: string;
    routes: RouteRule[];
}

export class AgentRouter {
    private defaultProvider: string;
    private routes: { provider: string; compiled: RegExp[] }[];

    constructor(config: RouterConfig) {
        this.defaultProvider = config.defaultProvider;
        this.routes = config.routes.map(r => ({
            provider: r.provider,
            compiled: r.patterns.map(p => new RegExp(p, 'i')),
        }));
        logger.info(`Agent router initialized with ${this.routes.length} route(s), default: ${this.defaultProvider}`);
    }

    /**
     * Given a user message, return the provider ID that should handle it.
     */
    resolve(text: string): string {
        for (const route of this.routes) {
            if (route.compiled.some(re => re.test(text))) {
                logger.info(`Routed to provider "${route.provider}" based on pattern match`);
                return route.provider;
            }
        }
        return this.defaultProvider;
    }
}
