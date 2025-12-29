import { Pool } from 'pg';
import { logger } from '../../core/monitoring/logger.js';
import {
  EmbeddingProvider,
  createEmbeddingProvider,
} from './embedding-provider.js';

export interface SemanticSearchConfig {
  pool: Pool;
  tableName: string;
  embeddingColumn: string;
  contentColumn: string;
  vectorDimensions: number;
  embeddingProvider?: EmbeddingProvider;
}

export interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  metadata?: Record<string, any>;
}

export class SemanticSearch {
  private pool: Pool;
  private config: SemanticSearchConfig;
  private embeddingProvider: EmbeddingProvider;

  constructor(config: SemanticSearchConfig) {
    this.pool = config.pool;
    this.config = config;
    this.embeddingProvider =
      config.embeddingProvider || createEmbeddingProvider('hybrid');

    // Verify dimensions match
    if (this.embeddingProvider.getDimensions() !== config.vectorDimensions) {
      logger.warn(
        `Embedding provider dimensions (${this.embeddingProvider.getDimensions()}) ` +
          `don't match config (${config.vectorDimensions}). Using provider dimensions.`
      );
      this.config.vectorDimensions = this.embeddingProvider.getDimensions();
    }
  }

  async createEmbedding(text: string): Promise<number[]> {
    return this.embeddingProvider.createEmbedding(text);
  }

  async indexContent(
    id: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const embedding = await this.createEmbedding(content);

    const query = `
      INSERT INTO ${this.config.tableName} (id, ${this.config.contentColumn}, ${this.config.embeddingColumn}, metadata)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE
      SET ${this.config.contentColumn} = $2,
          ${this.config.embeddingColumn} = $3,
          metadata = $4
    `;

    await this.pool.query(query, [
      id,
      content,
      `[${embedding.join(',')}]`,
      metadata ? JSON.stringify(metadata) : null,
    ]);
  }

  async search(
    query: string,
    limit = 10,
    threshold = 0.7
  ): Promise<SearchResult[]> {
    const queryEmbedding = await this.createEmbedding(query);

    const searchQuery = `
      SELECT 
        id,
        ${this.config.contentColumn} as content,
        metadata,
        1 - (${this.config.embeddingColumn} <=> $1::vector) as similarity
      FROM ${this.config.tableName}
      WHERE 1 - (${this.config.embeddingColumn} <=> $1::vector) > $2
      ORDER BY ${this.config.embeddingColumn} <=> $1::vector
      LIMIT $3
    `;

    const result = await this.pool.query(searchQuery, [
      `[${queryEmbedding.join(',')}]`,
      threshold,
      limit,
    ]);

    return result.rows.map((row: any) => ({
      id: row.id,
      content: row.content,
      similarity: row.similarity,
      metadata: row.metadata,
    }));
  }

  async findSimilar(id: string, limit = 10): Promise<SearchResult[]> {
    const query = `
      WITH target AS (
        SELECT ${this.config.embeddingColumn} as embedding
        FROM ${this.config.tableName}
        WHERE id = $1
      )
      SELECT 
        t.id,
        t.${this.config.contentColumn} as content,
        t.metadata,
        1 - (t.${this.config.embeddingColumn} <=> target.embedding) as similarity
      FROM ${this.config.tableName} t, target
      WHERE t.id != $1
      ORDER BY t.${this.config.embeddingColumn} <=> target.embedding
      LIMIT $2
    `;

    const result = await this.pool.query(query, [id, limit]);

    return result.rows.map((row: any) => ({
      id: row.id,
      content: row.content,
      similarity: row.similarity,
      metadata: row.metadata,
    }));
  }

  async cluster(
    k: number,
    maxIterations = 10
  ): Promise<Map<number, SearchResult[]>> {
    // K-means clustering using pgvector
    const query = `
      WITH clusters AS (
        SELECT 
          id,
          ${this.config.contentColumn} as content,
          metadata,
          kmeans(${this.config.embeddingColumn}, $1, $2) OVER () as cluster_id
        FROM ${this.config.tableName}
      )
      SELECT * FROM clusters ORDER BY cluster_id
    `;

    const result = await this.pool.query(query, [k, maxIterations]);

    const clusterMap = new Map<number, SearchResult[]>();

    for (const row of result.rows) {
      const clusterId = row.cluster_id;
      if (!clusterMap.has(clusterId)) {
        clusterMap.set(clusterId, []);
      }

      clusterMap.get(clusterId)!.push({
        id: row.id,
        content: row.content,
        similarity: 1.0, // Cluster membership
        metadata: row.metadata,
      });
    }

    return clusterMap;
  }

  async reindex(): Promise<void> {
    // Rebuild the IVFFlat index for better performance
    const query = `REINDEX INDEX CONCURRENTLY idx_${this.config.tableName}_embedding`;

    try {
      await this.pool.query(query);
      logger.info(`Reindexed ${this.config.tableName} embeddings`);
    } catch (error) {
      logger.error('Failed to reindex embeddings', error);
      throw error;
    }
  }

  async getStats(): Promise<{
    totalDocuments: number;
    avgSimilarity: number;
    indexSize: string;
  }> {
    const statsQuery = `
      SELECT 
        COUNT(*) as total,
        AVG(
          1 - (${this.config.embeddingColumn} <=> (
            SELECT AVG(${this.config.embeddingColumn})::vector 
            FROM ${this.config.tableName}
          ))
        ) as avg_similarity,
        pg_size_pretty(
          pg_relation_size('idx_${this.config.tableName}_embedding')
        ) as index_size
      FROM ${this.config.tableName}
    `;

    const result = await this.pool.query(statsQuery);
    const row: any = result.rows[0];

    return {
      totalDocuments: parseInt(row.total),
      avgSimilarity: parseFloat(row.avg_similarity) || 0,
      indexSize: row.index_size || '0 bytes',
    };
  }
}
