#!/usr/bin/env node

/**
 * ChromaDB Hook for Claude
 * Automatically preserves and retrieves context using ChromaDB vector storage
 * 
 * This hook runs automatically during Claude operations to:
 * - Store context on saves/clears
 * - Retrieve relevant context on queries
 * - Maintain semantic search history
 */

import { CloudClient } from 'chromadb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config({ 
  path: path.join(__dirname, '..', '.env'),
  override: true,
  silent: true
});

class ChromaDBHook {
  constructor() {
    this.config = {
      apiKey: process.env.CHROMADB_API_KEY,
      tenant: process.env.CHROMADB_TENANT,
      database: process.env.CHROMADB_DATABASE || 'stackmemory',
    };
    
    this.userId = process.env.USER || 'claude';
    this.teamId = process.env.CHROMADB_TEAM_ID;
    this.sessionId = process.env.CLAUDE_SESSION_ID || `session_${Date.now()}`;
    this.projectName = path.basename(process.cwd());
    
    this.client = null;
    this.collection = null;
    this.initialized = false;
    
    // Hook context from Claude
    this.hookType = process.argv[2] || 'unknown';
    this.hookData = process.argv[3] ? JSON.parse(process.argv[3]) : {};
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      if (!this.config.apiKey || !this.config.tenant) {
        this.log('ChromaDB not configured, skipping hook');
        return false;
      }

      this.client = new CloudClient({
        apiKey: this.config.apiKey,
        tenant: this.config.tenant,
        database: this.config.database,
      });

      this.collection = await this.client.getOrCreateCollection({
        name: 'claude_contexts',
        metadata: {
          description: 'Claude Code context storage',
          version: '1.0.0',
        },
      });

      this.initialized = true;
      return true;
    } catch (error) {
      this.logError('Failed to initialize ChromaDB', error);
      return false;
    }
  }

  /**
   * Store context in ChromaDB
   */
  async storeContext(type, content, metadata = {}) {
    if (!await this.initialize()) return;

    try {
      const contextId = `${type}_${this.sessionId}_${Date.now()}`;
      
      await this.collection.add({
        ids: [contextId],
        documents: [content],
        metadatas: [{
          user_id: this.userId,
          team_id: this.teamId,
          session_id: this.sessionId,
          project_name: this.projectName,
          type: type,
          timestamp: Date.now(),
          hook_type: this.hookType,
          ...metadata,
        }],
      });

      this.log(`Stored ${type} context`);
    } catch (error) {
      this.logError(`Failed to store ${type}`, error);
    }
  }

  /**
   * Query contexts by semantic similarity
   */
  async queryContexts(query, limit = 5) {
    if (!await this.initialize()) return [];

    try {
      const results = await this.collection.query({
        queryTexts: [query],
        nResults: limit,
        where: {
          user_id: this.userId,
          project_name: this.projectName,
        },
        include: ['documents', 'metadatas', 'distances'],
      });

      if (results.documents && results.documents[0]) {
        return results.documents[0].map((doc, i) => ({
          content: doc,
          metadata: results.metadatas[0][i],
          distance: results.distances[0][i],
        }));
      }

      return [];
    } catch (error) {
      this.logError('Failed to query contexts', error);
      return [];
    }
  }

  /**
   * Get recent contexts
   */
  async getRecentContexts(limit = 10, type = null) {
    if (!await this.initialize()) return [];

    try {
      const where = {
        user_id: this.userId,
        project_name: this.projectName,
      };
      
      if (type) {
        where.type = type;
      }

      const results = await this.collection.get({
        where: where,
        include: ['documents', 'metadatas'],
        limit: limit * 2, // Get more to sort by timestamp
      });

      if (results.documents) {
        const contexts = results.documents.map((doc, i) => ({
          content: doc,
          metadata: results.metadatas[i],
        }));

        // Sort by timestamp and limit
        return contexts
          .sort((a, b) => (b.metadata.timestamp || 0) - (a.metadata.timestamp || 0))
          .slice(0, limit);
      }

      return [];
    } catch (error) {
      this.logError('Failed to get recent contexts', error);
      return [];
    }
  }

  /**
   * Handle different hook types
   */
  async handleHook() {
    switch (this.hookType) {
      case 'on-save':
      case 'on-context-save':
        await this.handleSave();
        break;
        
      case 'on-clear':
      case 'on-session-end':
        await this.handleClear();
        break;
        
      case 'on-query':
      case 'on-search':
        await this.handleQuery();
        break;
        
      case 'on-task-complete':
        await this.handleTaskComplete();
        break;
        
      case 'on-decision':
        await this.handleDecision();
        break;
        
      case 'on-error':
        await this.handleError();
        break;
        
      case 'on-file-change':
        await this.handleFileChange();
        break;
        
      case 'periodic':
      case 'on-checkpoint':
        await this.handleCheckpoint();
        break;
        
      default:
        this.log(`Unknown hook type: ${this.hookType}`);
    }
  }

  async handleSave() {
    const content = this.hookData.content || this.getCurrentContext();
    await this.storeContext('save', content, {
      files: this.hookData.files,
      tags: this.hookData.tags,
    });
  }

  async handleClear() {
    // Save context before clear
    const content = this.hookData.content || this.getCurrentContext();
    await this.storeContext('clear', content, {
      reason: this.hookData.reason || 'manual',
      preserved: true,
    });
    
    // Generate summary
    const recentContexts = await this.getRecentContexts(20);
    if (recentContexts.length > 0) {
      const summary = this.generateSummary(recentContexts);
      await this.storeContext('summary', summary, {
        contexts_count: recentContexts.length,
      });
    }
  }

  async handleQuery() {
    const query = this.hookData.query || this.hookData.search;
    if (!query) return;

    // Find relevant contexts
    const contexts = await this.queryContexts(query, 5);
    
    if (contexts.length > 0) {
      // Store the query and results
      await this.storeContext('query', query, {
        results_count: contexts.length,
        top_distance: contexts[0].distance,
      });

      // Output relevant contexts for Claude
      this.outputContextsForClaude(contexts);
    }
  }

  async handleTaskComplete() {
    const task = this.hookData.task || {};
    await this.storeContext('task_complete', JSON.stringify(task), {
      task_id: task.id,
      task_title: task.title,
      duration: task.duration,
    });
  }

  async handleDecision() {
    const decision = this.hookData.decision || this.hookData.content;
    await this.storeContext('decision', decision, {
      importance: this.hookData.importance || 'normal',
    });
  }

  async handleError() {
    const error = this.hookData.error || this.hookData.message;
    await this.storeContext('error', error, {
      severity: this.hookData.severity || 'error',
      stack: this.hookData.stack,
    });
  }

  async handleFileChange() {
    const file = this.hookData.file || this.hookData.path;
    await this.storeContext('file_change', `Modified: ${file}`, {
      file: file,
      change_type: this.hookData.type || 'modify',
    });
  }

  async handleCheckpoint() {
    // Periodic checkpoint
    const content = this.getCurrentContext();
    await this.storeContext('checkpoint', content, {
      automatic: true,
      interval: this.hookData.interval || 900000, // 15 min default
    });

    // Clean old contexts
    await this.cleanOldContexts();
  }

  /**
   * Get current context from StackMemory
   */
  getCurrentContext() {
    try {
      // Try to get from StackMemory
      const contextFile = path.join(
        process.env.HOME,
        '.stackmemory',
        'shared-context',
        'projects',
        `${this.projectName}.json`
      );

      if (fs.existsSync(contextFile)) {
        const data = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
        return JSON.stringify(data.contexts || [], null, 2);
      }

      // Fallback to hook data
      return this.hookData.content || 'No context available';
    } catch (error) {
      return this.hookData.content || 'Context read error';
    }
  }

  /**
   * Generate summary of contexts
   */
  generateSummary(contexts) {
    const summary = {
      timestamp: new Date().toISOString(),
      project: this.projectName,
      session: this.sessionId,
      contexts_count: contexts.length,
      types: {},
      key_points: [],
    };

    for (const ctx of contexts) {
      const type = ctx.metadata.type || 'unknown';
      summary.types[type] = (summary.types[type] || 0) + 1;
      
      // Extract key points (first line or first 100 chars)
      const point = ctx.content.split('\n')[0].substring(0, 100);
      if (point && !summary.key_points.includes(point)) {
        summary.key_points.push(point);
      }
    }

    return JSON.stringify(summary, null, 2);
  }

  /**
   * Output contexts for Claude to use
   */
  outputContextsForClaude(contexts) {
    console.log('\n=== Relevant Context from ChromaDB ===\n');
    
    for (const ctx of contexts) {
      console.log(`Type: ${ctx.metadata.type || 'unknown'}`);
      console.log(`Time: ${new Date(ctx.metadata.timestamp).toLocaleString()}`);
      console.log(`Relevance: ${(1 - ctx.distance).toFixed(2)}`);
      console.log('---');
      console.log(ctx.content.substring(0, 500));
      console.log('\n');
    }
    
    console.log('=== End of Context ===\n');
  }

  /**
   * Clean old contexts (retention policy)
   */
  async cleanOldContexts() {
    if (!await this.initialize()) return;

    try {
      const cutoffTime = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days

      const results = await this.collection.get({
        where: {
          user_id: this.userId,
          timestamp: { $lt: cutoffTime },
        },
        include: ['ids'],
      });

      if (results.ids && results.ids.length > 0) {
        await this.collection.delete({
          ids: results.ids,
        });
        this.log(`Cleaned ${results.ids.length} old contexts`);
      }
    } catch (error) {
      this.logError('Failed to clean old contexts', error);
    }
  }

  log(message) {
    const logFile = path.join(
      process.env.HOME,
      '.stackmemory',
      'logs',
      'chromadb-hook.log'
    );
    
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    try {
      fs.appendFileSync(logFile, logMessage);
    } catch {
      // Silent fail
    }
  }

  logError(message, error) {
    this.log(`ERROR: ${message} - ${error.message}`);
  }
}

// Main execution
async function main() {
  const hook = new ChromaDBHook();
  
  try {
    await hook.handleHook();
  } catch (error) {
    hook.logError('Hook execution failed', error);
    // Don't fail the parent process
    process.exit(0);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(0); // Don't fail the parent
  });
}