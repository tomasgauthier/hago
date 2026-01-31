import { MemoryStore } from './store.js';
import { LLMProvider } from '../agent/providers/types.js';
import { logger } from '../utils/logger.js';

export class MemoryIndex {
    private store: MemoryStore;
    private embeddingProvider: LLMProvider | null;

    constructor(store: MemoryStore, embeddingProvider: LLMProvider | null) {
        this.store = store;
        this.embeddingProvider = embeddingProvider;
    }

    async addDocument(text: string, metadata: any) {
        if (!this.embeddingProvider) {
            logger.warn('No embedding provider configured — skipping document indexing');
            return;
        }

        // Simple chunking strategy: split by paragraphs
        const chunks = text.split(/\n\n+/).filter(c => c.trim().length > 0);

        for (const chunk of chunks) {
            try {
                const embedding = await this.embeddingProvider.getEmbedding(chunk);
                this.store.addChunk(chunk, metadata, embedding);
            } catch (err: any) {
                logger.error(`Failed to index chunk: ${err.message}`);
            }
        }
    }

    async query(text: string, limit: number = 5) {
        if (!this.embeddingProvider) {
            logger.warn('No embedding provider configured — memory query unavailable');
            return [];
        }

        try {
            const embedding = await this.embeddingProvider.getEmbedding(text);
            return this.store.search(embedding, limit);
        } catch (err: any) {
            logger.error(`Failed to query memory: ${err.message}`);
            return [];
        }
    }
}
