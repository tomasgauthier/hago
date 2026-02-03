/**
 * Internationalization Utilities
 *
 * Shared message formatting functions for the learning system
 */

/**
 * Format a localized message with parameter substitution
 *
 * @param lang - Language code (e.g., 'es', 'en', 'pt')
 * @param messages - Message dictionary keyed by language
 * @param key - Message key (supports dot notation for nested objects like 'status.ready')
 * @param params - Parameters to substitute in the message template
 * @returns Formatted message string
 *
 * @example
 * const messages = { en: { greeting: 'Hello {name}!' } };
 * formatMessage('en', messages, 'greeting', { name: 'World' });
 * // Returns: 'Hello World!'
 */
export function formatMessage(
    lang: string,
    messages: Record<string, any>,
    key: string,
    params: Record<string, any> = {}
): string {
    const langMessages = messages[lang] || messages.en || messages;
    let template: string;

    // Handle nested keys like 'status.ready'
    if (key.includes('.')) {
        const parts = key.split('.');
        let current: any = langMessages;
        for (const part of parts) {
            current = current?.[part];
            if (current === undefined) {
                // Try English fallback
                current = messages.en;
                for (const part of parts) {
                    current = current?.[part];
                }
                break;
            }
        }
        template = current || key;
    } else {
        template = langMessages[key] || messages.en?.[key] || key;
    }

    // Replace {paramName} with actual values
    return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
}

/**
 * Get the learning methodology title in the specified language
 *
 * @param lang - Language code
 * @returns Localized title (e.g., 'First Principles', 'Primeros Principios')
 */
export function getLearningTitle(lang: string): string {
    const titles: Record<string, string> = {
        es: 'Primeros Principios',
        en: 'First Principles',
        pt: 'Primeiros Princípios',
        fr: 'Premiers Principes',
        de: 'Erste Prinzipien'
    };
    return titles[lang] || titles.en;
}

/**
 * Create a progress bar visualization
 *
 * @param percent - Completion percentage (0-100)
 * @param length - Length of the bar in characters
 * @returns ASCII progress bar string
 *
 * @example
 * createProgressBar(75, 10);
 * // Returns: '███████░░░'
 */
export function createProgressBar(percent: number, length: number = 10): string {
    const filled = Math.round((percent / 100) * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Format a timestamp as a human-readable "time ago" string
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @param lang - Language code
 * @returns Formatted time ago string
 *
 * @example
 * formatTimeAgo(Date.now() - 3600000, 'en');
 * // Returns: '1h ago'
 */
export function formatTimeAgo(timestamp: number, lang: string): string {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    const units: Record<string, Record<string, string>> = {
        es: {
            mins: 'hace {n} min',
            hours: 'hace {n}h',
            days: 'hace {n} días',
            just: 'justo ahora'
        },
        en: {
            mins: '{n} min ago',
            hours: '{n}h ago',
            days: '{n} days ago',
            just: 'just now'
        },
        pt: {
            mins: 'há {n} min',
            hours: 'há {n}h',
            days: 'há {n} dias',
            just: 'agora mesmo'
        }
    };

    const u = units[lang] || units.en;

    if (diffMins < 1) return u.just;
    if (diffMins < 60) return u.mins.replace('{n}', String(diffMins));
    if (diffHours < 24) return u.hours.replace('{n}', String(diffHours));
    return u.days.replace('{n}', String(diffDays));
}

/**
 * Validate and normalize language code
 *
 * @param lang - Raw language code
 * @param fallback - Fallback language if invalid
 * @returns Normalized language code
 */
export function normalizeLanguage(lang: string | undefined, fallback: string = 'en'): string {
    if (!lang) return fallback;

    const normalized = lang.toLowerCase().trim().substring(0, 2);
    const supported = ['en', 'es', 'pt', 'fr', 'de'];

    return supported.includes(normalized) ? normalized : fallback;
}
