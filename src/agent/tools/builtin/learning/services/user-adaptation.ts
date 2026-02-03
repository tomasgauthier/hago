import { SessionStore, Message, UserLearningProfile } from '../../../../../sessions/store.js';
import { MindStore, MindAction } from '../../../../../mind/store.js';
import { logger } from '../../../../../utils/logger.js';
import Database from 'better-sqlite3';

/**
 * User Adaptation Service
 *
 * Personalizes learning content based on:
 * - Conversation history (language, difficulty)
 * - Tool usage patterns (analogy domains)
 * - Mind learnings (teaching preferences)
 * - Past learning performance
 *
 * This is haGo's unique differentiator for micro-learning.
 */

interface AdaptationContext {
    language: string;
    difficulty: 'beginner' | 'intermediate' | 'advanced';
    analogyDomains: string[];
    learningStyle?: string;
    teachingPace?: string;
}

interface LearningConfig {
    defaultLanguage: string;
    autoDetectLanguage: boolean;
    adaptiveDifficulty: boolean;
}

export class UserAdaptationService {
    private sessionStore: SessionStore;
    private mindStore: MindStore;
    private config: LearningConfig;

    constructor(sessionStore: SessionStore, mindStore: MindStore, config: LearningConfig) {
        this.sessionStore = sessionStore;
        this.mindStore = mindStore;
        this.config = config;
    }

    /**
     * Get complete adaptation context for a user
     */
    async getAdaptationContext(sessionKey: string, sessionId: number): Promise<AdaptationContext> {
        logger.info(`🎯 Building adaptation context for session: ${sessionKey}`);

        const profile = this._getUserLearningProfile(sessionKey);

        const language = await this.detectLanguage(sessionKey, sessionId, profile);
        const difficulty = await this.inferDifficulty(sessionKey, sessionId, profile);
        const analogyDomains = await this.detectAnalogyDomains(sessionKey);

        const context: AdaptationContext = {
            language,
            difficulty,
            analogyDomains,
            learningStyle: profile?.learningStyle,
            teachingPace: profile?.teachingPace
        };

        logger.info(`   Language: ${language}`);
        logger.info(`   Difficulty: ${difficulty}`);
        logger.info(`   Analogy domains: ${analogyDomains.join(', ')}`);

        return context;
    }

    /**
     * Detect user's language from conversation history
     */
    async detectLanguage(sessionKey: string, sessionId: number, profile?: UserLearningProfile | null): Promise<string> {
        // 1. Check user profile first
        if (profile?.preferredLanguage) {
            logger.info(`   → Using profile language: ${profile.preferredLanguage}`);
            return profile.preferredLanguage;
        }

        // 2. Check config
        if (!this.config.autoDetectLanguage) {
            logger.info(`   → Using default language: ${this.config.defaultLanguage}`);
            return this.config.defaultLanguage;
        }

        // 3. Analyze conversation history
        const history = this.sessionStore.getHistory(sessionId, 50);
        const userMessages = history.filter((m: Message) => m.role === 'user').map((m: Message) => m.content);
        const text = userMessages.join(' ').toLowerCase();

        // Language-specific patterns
        const patterns: Record<string, string[]> = {
            es: ['qué', 'cómo', 'por qué', 'cuál', 'dónde', 'gracias', 'hola', 'sí', 'está', 'tengo'],
            pt: ['você', 'não', 'obrigado', 'como', 'onde', 'quando', 'sim', 'olá', 'tchau'],
            fr: ['vous', 'comment', 'où', 'quand', 'merci', 'bonjour', 'oui', 'non', 'je'],
            de: ['wie', 'was', 'wo', 'wann', 'danke', 'hallo', 'ja', 'nein', 'ich']
        };

        const scores = Object.entries(patterns).map(([lang, words]) => ({
            lang,
            score: words.filter(word => text.includes(word)).length
        }));

        const best = scores.reduce((a, b) => a.score > b.score ? a : b, { lang: 'en', score: 0 });

        // Require at least 3 matches to be confident
        const detectedLang = best.score >= 3 ? best.lang : this.config.defaultLanguage;
        logger.info(`   → Detected language: ${detectedLang} (score: ${best.score})`);

        return detectedLang;
    }

    /**
     * Infer user's difficulty level from conversation history
     */
    async inferDifficulty(sessionKey: string, sessionId: number, profile?: UserLearningProfile | null): Promise<'beginner' | 'intermediate' | 'advanced'> {
        // 1. Check user profile
        if (profile?.preferredDifficulty) {
            logger.info(`   → Using profile difficulty: ${profile.preferredDifficulty}`);
            return profile.preferredDifficulty as any;
        }

        // 2. Check if adaptive difficulty is disabled
        if (!this.config.adaptiveDifficulty) {
            return 'intermediate'; // Safe default
        }

        // 3. Check mind learnings for explicit hints
        const learnings = this.mindStore.getApprovedLearnings();
        const difficultyHint = learnings.find((l: any) =>
            l.content.toLowerCase().includes('difficulty') ||
            l.content.toLowerCase().includes('level') ||
            l.content.toLowerCase().includes('beginner') ||
            l.content.toLowerCase().includes('advanced')
        );

        if (difficultyHint) {
            const extracted = this._extractDifficultyFromLearning(difficultyHint.content);
            if (extracted) {
                logger.info(`   → From mind learning: ${extracted}`);
                return extracted;
            }
        }

        // 4. Analyze conversation history for technical density
        const history = this.sessionStore.getHistory(sessionId, 50);
        const techTermDensity = this._analyzeTechTermDensity(history);

        logger.info(`   → Tech term density: ${(techTermDensity * 100).toFixed(1)}%`);

        if (techTermDensity > 0.3) return 'advanced';
        if (techTermDensity > 0.15) return 'intermediate';
        return 'beginner';
    }

    /**
     * Detect preferred analogy domains from tool usage
     */
    async detectAnalogyDomains(sessionKey: string): Promise<string[]> {
        const actions = this.mindStore.getRecentActions(30, sessionKey);
        const domains: string[] = [];

        // Check for Obsidian use (knowledge management)
        if (actions.filter((a: MindAction) => a.tool_name.startsWith('obsidian_')).length > 0) {
            domains.push('knowledge management');
        }

        // Check for shell commands (software development)
        if (actions.filter((a: MindAction) => a.tool_name === 'shell_execute').length > 5) {
            domains.push('software development');
        }

        // Check for browser automation (web development)
        if (actions.filter((a: MindAction) => a.tool_name.startsWith('browser_')).length > 0) {
            domains.push('web development');
        }

        // Check for finance tools (business)
        if (actions.filter((a: MindAction) =>
            a.tool_name.includes('finance') ||
            a.tool_name.includes('transaction')
        ).length > 0) {
            domains.push('business');
        }

        // Check for memory/RAG (research/learning)
        if (actions.filter((a: MindAction) => a.tool_name.startsWith('memory_')).length > 0) {
            domains.push('research');
        }

        return domains.length > 0 ? domains : ['general'];
    }

    /**
     * Get or create user learning profile
     */
    private _getUserLearningProfile(sessionKey: string): UserLearningProfile | null {
        try {
            const row = this.sessionStore.db.prepare(
                'SELECT * FROM user_learning_profiles WHERE session_key = ?'
            ).get(sessionKey) as any;

            if (!row) return null;

            return {
                id: row.id,
                sessionKey: row.session_key,
                preferredDifficulty: row.preferred_difficulty,
                preferredLanguage: row.preferred_language,
                avgModuleTimeSec: row.avg_module_time_sec,
                completionRate: row.completion_rate,
                quizAvgScore: row.quiz_avg_score,
                learningStyle: row.learning_style,
                teachingPace: row.teaching_pace,
                preferredAnalogyDomains: row.preferred_analogy_domains ?
                    JSON.parse(row.preferred_analogy_domains) : undefined,
                lastUpdated: row.last_updated
            };
        } catch (error: any) {
            logger.error(`Error fetching user learning profile: ${error.message}`);
            return null;
        }
    }

    /**
     * Update user learning profile
     */
    updateUserProfile(sessionKey: string, updates: Partial<UserLearningProfile>): void {
        try {
            const existing = this._getUserLearningProfile(sessionKey);
            const now = Date.now();

            if (existing) {
                // Update existing profile
                const fields: string[] = [];
                const values: any[] = [];

                if (updates.preferredDifficulty) {
                    fields.push('preferred_difficulty = ?');
                    values.push(updates.preferredDifficulty);
                }
                if (updates.preferredLanguage) {
                    fields.push('preferred_language = ?');
                    values.push(updates.preferredLanguage);
                }
                if (updates.avgModuleTimeSec !== undefined) {
                    fields.push('avg_module_time_sec = ?');
                    values.push(updates.avgModuleTimeSec);
                }
                if (updates.completionRate !== undefined) {
                    fields.push('completion_rate = ?');
                    values.push(updates.completionRate);
                }
                if (updates.quizAvgScore !== undefined) {
                    fields.push('quiz_avg_score = ?');
                    values.push(updates.quizAvgScore);
                }
                if (updates.learningStyle) {
                    fields.push('learning_style = ?');
                    values.push(updates.learningStyle);
                }
                if (updates.teachingPace) {
                    fields.push('teaching_pace = ?');
                    values.push(updates.teachingPace);
                }
                if (updates.preferredAnalogyDomains) {
                    fields.push('preferred_analogy_domains = ?');
                    values.push(JSON.stringify(updates.preferredAnalogyDomains));
                }

                fields.push('last_updated = ?');
                values.push(now);
                values.push(sessionKey);

                if (fields.length > 1) { // More than just last_updated
                    this.sessionStore.db.prepare(
                        `UPDATE user_learning_profiles SET ${fields.join(', ')} WHERE session_key = ?`
                    ).run(...values);

                    logger.info(`✅ Updated learning profile for ${sessionKey}`);
                }
            } else {
                // Create new profile
                this.sessionStore.db.prepare(`
                    INSERT INTO user_learning_profiles (
                        session_key, preferred_difficulty, preferred_language,
                        avg_module_time_sec, completion_rate, quiz_avg_score,
                        learning_style, teaching_pace, preferred_analogy_domains, last_updated
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    sessionKey,
                    updates.preferredDifficulty || null,
                    updates.preferredLanguage || null,
                    updates.avgModuleTimeSec || null,
                    updates.completionRate || null,
                    updates.quizAvgScore || null,
                    updates.learningStyle || null,
                    updates.teachingPace || null,
                    updates.preferredAnalogyDomains ? JSON.stringify(updates.preferredAnalogyDomains) : null,
                    now
                );

                logger.info(`✅ Created learning profile for ${sessionKey}`);
            }
        } catch (error: any) {
            logger.error(`Error updating user learning profile: ${error.message}`);
        }
    }

    /**
     * Analyze technical term density in messages
     */
    private _analyzeTechTermDensity(history: Message[]): number {
        const userMessages = history.filter(m => m.role === 'user');
        if (userMessages.length === 0) return 0;

        const text = userMessages.map(m => m.content).join(' ').toLowerCase();
        const words = text.split(/\s+/);

        // Common technical terms across domains
        const techTerms = [
            // Programming
            'function', 'algorithm', 'api', 'database', 'query', 'compile', 'deployment',
            'variable', 'array', 'object', 'class', 'method', 'interface', 'async',
            // Data/ML
            'neural', 'network', 'tensor', 'gradient', 'model', 'training', 'dataset',
            'feature', 'regression', 'classification', 'clustering', 'optimization',
            // System/Infrastructure
            'server', 'cloud', 'docker', 'kubernetes', 'microservice', 'architecture',
            'pipeline', 'ci/cd', 'container', 'virtual', 'protocol', 'latency',
            // Math/Science
            'matrix', 'vector', 'derivative', 'integral', 'equation', 'theorem',
            'hypothesis', 'probability', 'statistics', 'variance'
        ];

        const techWordCount = words.filter(word =>
            techTerms.some(term => word.includes(term))
        ).length;

        return words.length > 0 ? techWordCount / words.length : 0;
    }

    /**
     * Extract difficulty from mind learning content
     */
    private _extractDifficultyFromLearning(content: string): 'beginner' | 'intermediate' | 'advanced' | null {
        const lower = content.toLowerCase();

        if (lower.includes('beginner') || lower.includes('principiante') || lower.includes('básico')) {
            return 'beginner';
        }
        if (lower.includes('advanced') || lower.includes('avanzado') || lower.includes('experto')) {
            return 'advanced';
        }
        if (lower.includes('intermediate') || lower.includes('intermedio')) {
            return 'intermediate';
        }

        return null;
    }
}
