/**
 * Simplified ChromaDB adapter for Claude hooks
 */

import { ChromaClient } from 'chromadb';
import { v4 as uuidv4 } from 'uuid';

export class ChromaDBAdapter {
  private client: ChromaClient;
  private collection: any = null;
  private config: any;
  private fallbackStorage: Map<string, any> = new Map();
  
  constructor(config: any) {
    this.config = config;
    
    try {
      // Try to initialize ChromaDB client
      if (config.apiUrl && config.apiUrl.includes('trychroma.com')) {
        // Cloud configuration
        this.client = new ChromaClient({
          ssl: true,
          host: 'api.trychroma.com',
          port: 443,
          headers: {
            'X-Chroma-Token': config.apiKey
          }
        });
      } else {
        // In-memory/local configuration (no external service needed)
        this.client = new ChromaClient();
      }
    } catch (error: unknown) {
      // Fallback to in-memory client
      console.log('Using in-memory ChromaDB client');
      this.client = new ChromaClient();
    }
  }

  async initialize(): Promise<void> {
    try {
      // Use a single collection for all context
      const collectionName = this.config.collectionName || 'stackmemory_context';
      
      // Get or create collection
      this.collection = await this.client.getOrCreateCollection({
        name: collectionName,
        metadata: {
          description: 'StackMemory Claude context',
          version: '2.0.0'
        }
      });
      
      console.log(`[${new Date().toISOString()}] INFO: ChromaDB collection '${collectionName}' initialized`);
    } catch (error: any) {
      console.log(`ChromaDB service not available, using JSON fallback storage`);
      this.collection = null; // Use fallback
    }
  }

  async store(context: any): Promise<any> {
    const id = context.id || `ctx_${uuidv4()}`;
    
    // Prepare metadata - only include non-undefined values
    const metadata: any = {
      timestamp: context.timestamp || new Date().toISOString(),
      type: context.type || 'context',
      user_id: context.user_id || this.config.userId || 'default',
      project: context.project || 'stackmemory'
    };

    // Add optional metadata if defined
    if (context.session_id) metadata.session_id = context.session_id;
    if (context.metadata) {
      Object.entries(context.metadata).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          metadata[key] = value;
        }
      });
    }

    if (!this.collection) {
      await this.initialize();
    }

    try {
      if (this.collection) {
        // Store in ChromaDB if available
        await this.collection.upsert({
          ids: [id],
          documents: [context.content || JSON.stringify(context)],
          metadatas: [metadata]
        });
      } else {
        // Fallback to JSON file storage
        await this.storeToJsonFallback(id, context, metadata);
      }

      return { 
        success: true, 
        id,
        stored_at: new Date().toISOString()
      };
    } catch (error: any) {
      console.error('Failed to store context:', error.message);
      // Try fallback storage
      try {
        await this.storeToJsonFallback(id, context, metadata);
        return { success: true, id, stored_at: new Date().toISOString() };
      } catch (fallbackError: any) {
        return { success: false, error: fallbackError.message };
      }
    }
  }

  private async storeToJsonFallback(id: string, context: any, metadata: any): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    
    const storageDir = path.join(os.homedir(), '.stackmemory', 'context-storage');
    const storageFile = path.join(storageDir, 'contexts.jsonl');

    // Ensure directory exists
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    const entry = {
      id,
      content: context.content || JSON.stringify(context),
      metadata,
      stored_at: new Date().toISOString()
    };

    // Append to JSONL file
    fs.appendFileSync(storageFile, JSON.stringify(entry) + '\n');
  }

  async search(params: any): Promise<any[]> {
    if (!this.collection) {
      await this.initialize();
    }

    try {
      const query = params.query || '';
      const limit = params.limit || 10;
      
      // Build where clause
      const where: any = {};
      if (params.filter) {
        Object.entries(params.filter).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            where[key] = value;
          }
        });
      }

      // Query collection
      const results = await this.collection.query({
        queryTexts: [query],
        nResults: limit,
        where: Object.keys(where).length > 0 ? where : undefined
      });

      // Format results
      const contexts: any[] = [];
      if (results.documents && results.documents[0]) {
        for (let i = 0; i < results.documents[0].length; i++) {
          contexts.push({
            id: results.ids[0][i],
            content: results.documents[0][i],
            metadata: results.metadatas?.[0]?.[i] || {},
            distance: results.distances?.[0]?.[i] || 0
          });
        }
      }

      return contexts;
    } catch (error: any) {
      console.error('Failed to search contexts:', error.message);
      return [];
    }
  }

  async deleteCollection(): Promise<void> {
    if (this.collection) {
      await this.client.deleteCollection({
        name: this.config.collectionName || 'stackmemory_context'
      });
      console.log('Collection deleted');
    }
  }

  async listCollections(): Promise<any[]> {
    const collections = await this.client.listCollections();
    return collections;
  }
}

export default ChromaDBAdapter;