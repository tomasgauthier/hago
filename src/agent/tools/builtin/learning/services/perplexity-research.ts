import { logger } from '../../../../../utils/logger.js';
import { API_CONFIG, SOURCE_LEVELS } from '../utils/constants.js';
import { ResearchSource, PerplexityResponse } from '../utils/types.js';

/**
 * Perplexity Research Service
 *
 * Uses Perplexity API for academic research with 7-level source hierarchy,
 * or falls back to haGo's web_search tool if no API key is configured.
 */

interface ResearchResult {
    summary: string;
    sources: ResearchSource[];
}

interface PerplexityConfig {
    apiKey?: string;
    model?: string;
}

export class PerplexityResearchService {
    private config: PerplexityConfig;
    private webSearchFallback?: (query: string) => Promise<any>;

    constructor(config: PerplexityConfig, webSearchFallback?: (query: string) => Promise<any>) {
        this.config = config;
        this.webSearchFallback = webSearchFallback;
    }

    /**
     * Research a topic using Perplexity or web_search fallback
     */
    async research(topic: string, language: string = 'en'): Promise<ResearchResult> {
        if (this.config.apiKey) {
            logger.info(`🔍 Researching "${topic}" via Perplexity API (${language})`);
            return await this._perplexityResearch(topic, language);
        } else if (this.webSearchFallback) {
            logger.info(`🔍 Researching "${topic}" via web_search fallback (${language})`);
            return await this._webSearchFallback(topic, language);
        } else {
            logger.warn('⚠️  No research method available, returning minimal data');
            return {
                summary: `Research topic: ${topic}`,
                sources: []
            };
        }
    }

    /**
     * Use Perplexity API for research with timeout
     */
    private async _perplexityResearch(topic: string, language: string): Promise<ResearchResult> {
        const query = this._buildResearchQuery(topic, language);

        try {
            // Create an AbortController for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.PERPLEXITY_TIMEOUT_MS);

            const response = await fetch('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.config.model || API_CONFIG.DEFAULT_PERPLEXITY_MODEL,
                    messages: [
                        {
                            role: 'system',
                            content: language === 'es'
                                ? 'Eres un investigador académico. Busca fuentes autorizadas y fundamentales sobre el tema.'
                                : 'You are an academic researcher. Search for authoritative and fundamental sources on the topic.'
                        },
                        {
                            role: 'user',
                            content: query
                        }
                    ],
                    temperature: API_CONFIG.RESEARCH_TEMPERATURE,
                    return_citations: true
                }),
                signal: controller.signal
            }).finally(() => clearTimeout(timeoutId));

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`Perplexity API error ${response.status}: ${errorText}`);
            }

            const data = await response.json() as PerplexityResponse;
            const summary = data.choices[0]?.message?.content || '';
            const citations = data.citations || [];

            // Extract and rank sources
            const sources = citations.map((citation: any, index: number) => ({
                title: citation.title || `Source ${index + 1}`,
                url: citation.url || '',
                type: this._inferSourceType(citation.url || ''),
                level: this._getSourceLevel(citation.url || '')
            })).sort((a: any, b: any) => a.level - b.level);

            logger.info(`✅ Found ${sources.length} sources (Perplexity)`);
            return { summary, sources };

        } catch (error: any) {
            // Check if it was a timeout
            if (error.name === 'AbortError') {
                logger.error(`❌ Perplexity API timeout after ${API_CONFIG.PERPLEXITY_TIMEOUT_MS}ms`);
            } else {
                logger.error('❌ Perplexity API error:', error.message);
            }
            // Fall back to web search if available
            if (this.webSearchFallback) {
                logger.info('↩️  Falling back to web_search');
                return await this._webSearchFallback(topic, language);
            }
            throw error;
        }
    }

    /**
     * Fallback to haGo's web_search tool
     */
    private async _webSearchFallback(topic: string, language: string): Promise<ResearchResult> {
        if (!this.webSearchFallback) {
            throw new Error('No web_search fallback configured');
        }

        try {
            const query = this._buildResearchQuery(topic, language);
            const results = await this.webSearchFallback(query);

            // Parse web search results (format depends on web_search tool)
            const sources = Array.isArray(results) ? results.map((result: any, index: number) => ({
                title: result.title || `Result ${index + 1}`,
                url: result.url || result.link || '',
                type: this._inferSourceType(result.url || result.link || ''),
                level: this._getSourceLevel(result.url || result.link || '')
            })).sort((a: any, b: any) => a.level - b.level) : [];

            const summary = `Research results for: ${topic}`;

            logger.info(`✅ Found ${sources.length} sources (web_search fallback)`);
            return { summary, sources };

        } catch (error: any) {
            logger.error('❌ Web search fallback error:', error.message);
            return {
                summary: `Unable to research: ${topic}`,
                sources: []
            };
        }
    }

    /**
     * Build research query based on language
     */
    private _buildResearchQuery(topic: string, language: string): string {
        const queries: Record<string, string> = {
            es: `Busca fuentes académicas y fundamentales sobre: ${topic}. Prioriza documentación oficial, artículos revisados por pares, y definiciones autorizadas.`,
            en: `Search for academic and fundamental sources about: ${topic}. Prioritize official documentation, peer-reviewed articles, and authoritative definitions.`,
            pt: `Busque fontes acadêmicas e fundamentais sobre: ${topic}. Priorize documentação oficial, artigos revisados por pares e definições autorizadas.`
        };

        return queries[language] || queries.en;
    }

    /**
     * Infer source type from URL
     */
    private _inferSourceType(url: string): string {
        const lower = url.toLowerCase();

        if (lower.includes('arxiv.org')) return 'academic-preprint';
        if (lower.includes('ieee.org') || lower.includes('acm.org')) return 'standards';
        if (lower.includes('nature.com') || lower.includes('science.org')) return 'journal';
        if (lower.includes('wikipedia.org')) return 'encyclopedia';
        if (lower.includes('github.com') || lower.includes('gitlab.com')) return 'repository';
        if (lower.match(/\.(edu|gov)\//)) return 'institutional';
        if (lower.includes('docs.') || lower.includes('/docs/')) return 'documentation';

        return 'general';
    }

    /**
     * Get source hierarchy level (1 = highest quality)
     */
    private _getSourceLevel(url: string): number {
        const lower = url.toLowerCase();

        // Level 1: Axioms - fundamental sources
        if (lower.includes('arxiv.org') || lower.includes('plato.stanford.edu')) return SOURCE_LEVELS.AXIOMS;

        // Level 2: Standards bodies
        if (lower.includes('ieee.org') || lower.includes('acm.org') ||
            lower.includes('iso.org') || lower.includes('ietf.org') ||
            lower.includes('w3.org')) return SOURCE_LEVELS.STANDARDS;

        // Level 3: Top scientific journals
        if (lower.includes('nature.com') || lower.includes('science.org') ||
            lower.includes('cell.com')) return SOURCE_LEVELS.TOP_JOURNALS;

        // Level 4: Official documentation
        if (lower.includes('python.org/docs') || lower.includes('developer.mozilla.org') ||
            lower.includes('reactjs.org') || lower.includes('nodejs.org/docs')) return SOURCE_LEVELS.DOCUMENTATION;

        // Level 5: Code repositories
        if (lower.includes('github.com') || lower.includes('gitlab.com')) return SOURCE_LEVELS.REPOSITORIES;

        // Level 6: Academic publishers
        if (lower.includes('springer.com') || lower.includes('wiley.com') ||
            lower.includes('sciencedirect.com') || lower.includes('jstor.org')) return SOURCE_LEVELS.PUBLISHERS;

        // Level 7: Educational institutions
        if (lower.includes('mit.edu') || lower.includes('stanford.edu') ||
            lower.includes('harvard.edu') || lower.includes('coursera.org') ||
            lower.includes('edx.org')) return SOURCE_LEVELS.EDUCATIONAL;

        // Default: general web source
        return SOURCE_LEVELS.GENERAL;
    }
}
