import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

export interface MemoryChunk {
    id: number;
    content: string;
    metadata: string;
}

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

export class MemoryStore {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.init();
    }

    private init() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS memory_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT,
                metadata TEXT,
                embedding BLOB,
                created_at INTEGER
            );
        `);

        // Add embedding column if upgrading from old schema
        try {
            this.db.exec(`ALTER TABLE memory_chunks ADD COLUMN embedding BLOB`);
        } catch {
            // Column already exists
        }

        logger.info('Memory store initialized (pure JS vector search)');
    }

    addChunk(content: string, metadata: any, embedding: number[]) {
        const now = Date.now();
        const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);

        this.db.prepare(
            'INSERT INTO memory_chunks (content, metadata, embedding, created_at) VALUES (?, ?, ?, ?)'
        ).run(content, JSON.stringify(metadata), embeddingBlob, now);
    }

    search(queryEmbedding: number[], limit: number = 5) {
        const rows = this.db.prepare(
            'SELECT id, content, metadata, embedding FROM memory_chunks WHERE embedding IS NOT NULL'
        ).all() as any[];

        if (rows.length === 0) {
            // Fall back to recency if no embeddings stored
            const recent = this.db.prepare(
                'SELECT content, metadata FROM memory_chunks ORDER BY created_at DESC LIMIT ?'
            ).all(limit) as any[];
            return recent.map(r => ({
                content: r.content,
                metadata: JSON.parse(r.metadata),
            }));
        }

        const scored = rows.map(r => {
            const stored = Array.from(new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4));
            return {
                content: r.content,
                metadata: JSON.parse(r.metadata),
                similarity: cosineSimilarity(queryEmbedding, stored),
            };
        });

        scored.sort((a, b) => b.similarity - a.similarity);

        return scored.slice(0, limit).map(s => ({
            content: s.content,
            metadata: s.metadata,
            distance: 1 - s.similarity,
        }));
    }
}
