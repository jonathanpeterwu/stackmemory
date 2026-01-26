/**
 * ChromaDB Storage Adapter for StackMemory
 *
 * Provides vector storage and semantic search capabilities for context data
 * using ChromaDB cloud service with user and team segmentation.
 */

import { CloudClient, Collection } from 'chromadb';
import { v4 as uuidv4 } from 'uuid';
import { Frame } from '../context/index.js';
import { Logger } from '../monitoring/logger.js';

interface ChromaDocument {
  id: string;
  document: string;
  metadata: {
    user_id: string;
    team_id?: string;
    frame_id: string;
    session_id: string;
    project_name: string;
    timestamp: number;
    type: 'frame' | 'decision' | 'observation' | 'context';
    score?: number;
    tags?: string[];
  };
}

interface ChromaConfig {
  apiKey: string;
  tenant: string;
  database: string;
  collectionName?: string;
}

export class ChromaDBAdapter {
  private client: CloudClient;
  private collection: Collection | null = null;
  private logger: Logger;
  private config: ChromaConfig;
  private userId: string;
  private teamId?: string;

  constructor(config: ChromaConfig, userId: string, teamId?: string) {
    this.config = config;
    this.userId = userId;
    this.teamId = teamId;
    this.logger = new Logger('ChromaDBAdapter');

    // Initialize ChromaDB client
    this.client = new CloudClient({
      apiKey: config.apiKey,
      tenant: config.tenant,
      database: config.database,
    });
  }

  async initialize(): Promise<void> {
    try {
      const collectionName =
        this.config.collectionName || 'stackmemory_contexts';

      // Get or create collection with metadata for filtering
      this.collection = await this.client.getOrCreateCollection({
        name: collectionName,
        metadata: {
          description: 'StackMemory context storage',
          version: '1.0.0',
          created_at: new Date().toISOString(),
        },
      });

      this.logger.info(`ChromaDB collection '${collectionName}' initialized`);
    } catch (error: unknown) {
      this.logger.error('Failed to initialize ChromaDB collection', error);
      throw error;
    }
  }

  /**
   * Store a frame in ChromaDB
   */
  async storeFrame(frame: Frame): Promise<void> {
    if (!this.collection) {
      throw new Error('ChromaDB not initialized');
    }

    try {
      // Prepare document from frame
      const frameMetadata: any = {
        user_id: this.userId,
        frame_id: frame.frameId,
        session_id: frame.sessionId || 'unknown',
        project_name: frame.projectName || 'default',
        timestamp: frame.timestamp,
        type: 'frame',
        score: frame.score,
        tags: frame.tags || [],
      };

      // Only add team_id if it exists
      if (this.teamId) {
        frameMetadata.team_id = this.teamId;
      }

      const document: ChromaDocument = {
        id: `frame_${frame.frameId}_${this.userId}`,
        document: this.frameToDocument(frame),
        metadata: frameMetadata,
      };

      // Add to ChromaDB
      await this.collection.add({
        ids: [document.id],
        documents: [document.document],
        metadatas: [document.metadata],
      });

      this.logger.debug(
        `Stored frame ${frame.frameId} for user ${this.userId}`
      );
    } catch (error: unknown) {
      this.logger.error(`Failed to store frame ${frame.frameId}`, error);
      throw error;
    }
  }

  /**
   * Store a decision or observation
   */
  async storeContext(
    type: 'decision' | 'observation',
    content: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (!this.collection) {
      throw new Error('ChromaDB not initialized');
    }

    try {
      const contextId = `${type}_${uuidv4()}_${this.userId}`;

      const documentMetadata: any = {
        user_id: this.userId,
        frame_id: metadata?.frame_id || 'none',
        session_id: metadata?.session_id || 'unknown',
        project_name: metadata?.project_name || 'default',
        timestamp: Date.now(),
        type,
        ...metadata,
      };

      // Only add team_id if it exists (ChromaDB doesn't accept undefined values)
      if (this.teamId) {
        documentMetadata.team_id = this.teamId;
      }

      const document: ChromaDocument = {
        id: contextId,
        document: content,
        metadata: documentMetadata,
      };

      await this.collection.add({
        ids: [document.id],
        documents: [document.document],
        metadatas: [document.metadata],
      });

      this.logger.debug(`Stored ${type} for user ${this.userId}`);
    } catch (error: unknown) {
      this.logger.error(`Failed to store ${type}`, error);
      throw error;
    }
  }

  /**
   * Query contexts by semantic similarity
   */
  async queryContexts(
    query: string,
    limit: number = 10,
    filters?: {
      type?: string[];
      projectName?: string;
      sessionId?: string;
      startTime?: number;
      endTime?: number;
    }
  ): Promise<Array<{ content: string; metadata: any; distance: number }>> {
    if (!this.collection) {
      throw new Error('ChromaDB not initialized');
    }

    try {
      // Build where clause for filtering
      const whereClause: any = {
        user_id: this.userId,
      };

      // Add team filter if applicable
      if (this.teamId) {
        whereClause['$or'] = [
          { team_id: this.teamId },
          { user_id: this.userId },
        ];
      }

      // Add additional filters
      if (filters?.type && filters.type.length > 0) {
        whereClause.type = { $in: filters.type };
      }

      if (filters?.projectName) {
        whereClause.project_name = filters.projectName;
      }

      if (filters?.sessionId) {
        whereClause.session_id = filters.sessionId;
      }

      if (filters?.startTime || filters?.endTime) {
        whereClause.timestamp = {};
        if (filters.startTime) {
          whereClause.timestamp.$gte = filters.startTime;
        }
        if (filters.endTime) {
          whereClause.timestamp.$lte = filters.endTime;
        }
      }

      // Query ChromaDB
      const results = await this.collection.query({
        queryTexts: [query],
        nResults: limit,
        where: whereClause,
        include: ['documents', 'metadatas', 'distances'],
      });

      // Format results
      const contexts: Array<{
        content: string;
        metadata: any;
        distance: number;
      }> = [];

      if (results.documents && results.documents[0]) {
        for (let i = 0; i < results.documents[0].length; i++) {
          contexts.push({
            content: results.documents[0][i] || '',
            metadata: results.metadatas?.[0]?.[i] || {},
            distance: results.distances?.[0]?.[i] || 0,
          });
        }
      }

      this.logger.debug(`Found ${contexts.length} contexts for query`);
      return contexts;
    } catch (error: unknown) {
      this.logger.error('Failed to query contexts', error);
      throw error;
    }
  }

  /**
   * Get user's recent contexts
   */
  async getRecentContexts(
    limit: number = 20,
    type?: string
  ): Promise<Array<{ content: string; metadata: any }>> {
    if (!this.collection) {
      throw new Error('ChromaDB not initialized');
    }

    try {
      const whereClause: any = {
        user_id: this.userId,
      };

      if (type) {
        whereClause.type = type;
      }

      // Get all documents for the user (ChromaDB doesn't support direct ordering)
      const results = await this.collection.get({
        where: whereClause,
        include: ['documents', 'metadatas'],
      });

      // Sort by timestamp and limit
      const contexts: Array<{ content: string; metadata: any }> = [];

      if (results.documents) {
        const indexed = results.documents.map((doc, i) => ({
          content: doc || '',
          metadata: results.metadatas?.[i] || {},
        }));

        // Sort by timestamp descending
        indexed.sort(
          (a, b) => (b.metadata.timestamp || 0) - (a.metadata.timestamp || 0)
        );

        // Take limit
        contexts.push(...indexed.slice(0, limit));
      }

      return contexts;
    } catch (error: unknown) {
      this.logger.error('Failed to get recent contexts', error);
      throw error;
    }
  }

  /**
   * Delete old contexts (retention policy)
   */
  async deleteOldContexts(olderThanDays: number = 30): Promise<number> {
    if (!this.collection) {
      throw new Error('ChromaDB not initialized');
    }

    try {
      const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

      // Get old documents
      const results = await this.collection.get({
        where: {
          user_id: this.userId,
          timestamp: { $lt: cutoffTime },
        },
        include: ['ids'],
      });

      if (!results.ids || results.ids.length === 0) {
        return 0;
      }

      // Delete old documents
      await this.collection.delete({
        ids: results.ids,
      });

      this.logger.info(`Deleted ${results.ids.length} old contexts`);
      return results.ids.length;
    } catch (error: unknown) {
      this.logger.error('Failed to delete old contexts', error);
      throw error;
    }
  }

  /**
   * Get team contexts (if user is part of a team)
   */
  async getTeamContexts(
    limit: number = 20
  ): Promise<Array<{ content: string; metadata: any }>> {
    if (!this.collection || !this.teamId) {
      return [];
    }

    try {
      const results = await this.collection.get({
        where: {
          team_id: this.teamId,
        },
        include: ['documents', 'metadatas'],
        limit,
      });

      const contexts: Array<{ content: string; metadata: any }> = [];

      if (results.documents) {
        for (let i = 0; i < results.documents.length; i++) {
          contexts.push({
            content: results.documents[i] || '',
            metadata: results.metadatas?.[i] || {},
          });
        }
      }

      return contexts;
    } catch (error: unknown) {
      this.logger.error('Failed to get team contexts', error);
      return [];
    }
  }

  /**
   * Convert frame to searchable document
   */
  private frameToDocument(frame: Frame): string {
    const parts = [
      `Frame: ${frame.title}`,
      `Type: ${frame.type}`,
      `Status: ${frame.status}`,
    ];

    if (frame.description) {
      parts.push(`Description: ${frame.description}`);
    }

    if (frame.inputs && frame.inputs.length > 0) {
      parts.push(`Inputs: ${frame.inputs.join(', ')}`);
    }

    if (frame.outputs && frame.outputs.length > 0) {
      parts.push(`Outputs: ${frame.outputs.join(', ')}`);
    }

    if (frame.tags && frame.tags.length > 0) {
      parts.push(`Tags: ${frame.tags.join(', ')}`);
    }

    if (frame.digest_json) {
      try {
        const digest = JSON.parse(frame.digest_json);
        if (digest.summary) {
          parts.push(`Summary: ${digest.summary}`);
        }
        if (digest.keyDecisions) {
          parts.push(`Decisions: ${digest.keyDecisions.join('. ')}`);
        }
      } catch {
        // Ignore parse errors
      }
    }

    return parts.join('\n');
  }

  /**
   * Update team ID for a user
   */
  async updateTeamId(newTeamId: string): Promise<void> {
    this.teamId = newTeamId;
    this.logger.info(`Updated team ID to ${newTeamId} for user ${this.userId}`);
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    totalDocuments: number;
    userDocuments: number;
    teamDocuments?: number;
    documentsByType: Record<string, number>;
  }> {
    if (!this.collection) {
      throw new Error('ChromaDB not initialized');
    }

    try {
      // Get user documents
      const userResults = await this.collection.get({
        where: { user_id: this.userId },
        include: ['metadatas'],
      });

      const stats: any = {
        totalDocuments: 0,
        userDocuments: userResults.ids?.length || 0,
        documentsByType: {},
      };

      // Count by type
      if (userResults.metadatas) {
        for (const metadata of userResults.metadatas) {
          const type = metadata?.type || 'unknown';
          stats.documentsByType[type] = (stats.documentsByType[type] || 0) + 1;
        }
      }

      // Get team documents if applicable
      if (this.teamId) {
        const teamResults = await this.collection.get({
          where: { team_id: this.teamId },
          include: ['ids'],
        });
        stats.teamDocuments = teamResults.ids?.length || 0;
      }

      stats.totalDocuments = stats.userDocuments + (stats.teamDocuments || 0);

      return stats;
    } catch (error: unknown) {
      this.logger.error('Failed to get stats', error);
      throw error;
    }
  }
}
