import { ProviderConfig } from '../config/schema.js';

interface UsageStats {
    lastUsed: number;
    cooldownUntil: number;
}

export class AuthRotationManager {
    private stats: Map<string, UsageStats> = new Map();

    pickProfile(profiles: ProviderConfig[]): ProviderConfig {
        const now = Date.now();
        const available = profiles.filter(p => {
            const stat = this.stats.get(p.id);
            return !stat || stat.cooldownUntil < now;
        });

        if (available.length === 0) {
            // If all on cooldown, return the one with earliest cooldown expiration
            return profiles.sort((a, b) => {
                const statA = this.stats.get(a.id)?.cooldownUntil || 0;
                const statB = this.stats.get(b.id)?.cooldownUntil || 0;
                return statA - statB;
            })[0];
        }

        // Return least recently used
        return available.sort((a, b) => {
            const statA = this.stats.get(a.id)?.lastUsed || 0;
            const statB = this.stats.get(b.id)?.lastUsed || 0;
            return statA - statB;
        })[0];
    }

    markUsed(id: string) {
        const stat = this.stats.get(id) || { lastUsed: 0, cooldownUntil: 0 };
        stat.lastUsed = Date.now();
        this.stats.set(id, stat);
    }

    setCooldown(id: string, durationMs: number) {
        const stat = this.stats.get(id) || { lastUsed: 0, cooldownUntil: 0 };
        stat.cooldownUntil = Date.now() + durationMs;
        this.stats.set(id, stat);
    }
}
