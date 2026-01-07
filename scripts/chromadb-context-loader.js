#!/usr/bin/env node

/**
 * ChromaDB Context Loader
 * Loads and synchronizes context from ChromaDB for Claude sessions
 */

import { CloudClient } from 'chromadb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config({ 
  path: path.join(__dirname, '..', '.env'),
  override: true,
  silent: true
});

class ContextLoader {
  constructor() {
    this.config = {
      apiKey: process.env.CHROMADB_API_KEY,
      tenant: process.env.CHROMADB_TENANT,
      database: process.env.CHROMADB_DATABASE || 'stackmemory',
    };
    
    this.userId = process.env.USER || 'claude';
    this.projectName = path.basename(process.cwd());
    this.client = null;
    this.collection = null;
  }

  async initialize() {
    try {
      this.client = new CloudClient({
        apiKey: this.config.apiKey,
        tenant: this.config.tenant,
        database: this.config.database,
      });

      this.collection = await this.client.getOrCreateCollection({
        name: 'claude_contexts',
      });

      return true;
    } catch (error) {
      console.error(chalk.red('Failed to initialize ChromaDB:'), error.message);
      return false;
    }
  }

  /**
   * Load recent context from ChromaDB
   */
  async loadRecentContext(hours = 24) {
    console.log(chalk.cyan(`\n📥 Loading context from last ${hours} hours...\n`));
    
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
    
    try {
      const results = await this.collection.get({
        where: {
          $and: [
            { user_id: { $eq: this.userId } },
            { project_name: { $eq: this.projectName } },
            { timestamp: { $gte: cutoffTime } }
          ]
        },
        include: ['documents', 'metadatas'],
      });

      if (!results.documents || results.documents.length === 0) {
        console.log(chalk.yellow('No recent context found'));
        return [];
      }

      // Group by type
      const contextsByType = {};
      for (let i = 0; i < results.documents.length; i++) {
        const doc = results.documents[i];
        const meta = results.metadatas[i];
        const type = meta.type || 'unknown';
        
        if (!contextsByType[type]) {
          contextsByType[type] = [];
        }
        
        contextsByType[type].push({
          content: doc,
          metadata: meta,
          time: new Date(meta.timestamp).toLocaleString(),
        });
      }

      // Display organized context
      console.log(chalk.green(`Found ${results.documents.length} contexts:\n`));
      
      for (const [type, contexts] of Object.entries(contextsByType)) {
        console.log(chalk.bold.blue(`\n${type.toUpperCase()} (${contexts.length}):`));
        console.log('─'.repeat(50));
        
        for (const ctx of contexts.slice(0, 5)) { // Show first 5 of each type
          console.log(chalk.gray(`[${ctx.time}]`));
          console.log(ctx.content.substring(0, 200));
          if (ctx.content.length > 200) {
            console.log(chalk.gray('...'));
          }
          console.log();
        }
        
        if (contexts.length > 5) {
          console.log(chalk.gray(`... and ${contexts.length - 5} more ${type} contexts\n`));
        }
      }

      return results.documents;
    } catch (error) {
      console.error(chalk.red('Failed to load context:'), error.message);
      return [];
    }
  }

  /**
   * Load context for specific query
   */
  async loadQueryContext(query, limit = 10) {
    console.log(chalk.cyan(`\n🔍 Searching for: "${query}"\n`));
    
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

      if (!results.documents || !results.documents[0] || results.documents[0].length === 0) {
        console.log(chalk.yellow('No matching contexts found'));
        return [];
      }

      console.log(chalk.green(`Found ${results.documents[0].length} relevant contexts:\n`));
      
      for (let i = 0; i < results.documents[0].length; i++) {
        const doc = results.documents[0][i];
        const meta = results.metadatas[0][i];
        const distance = results.distances[0][i];
        const relevance = ((1 - distance) * 100).toFixed(1);
        
        console.log(chalk.bold(`${i + 1}. [${meta.type}] Relevance: ${relevance}%`));
        console.log(chalk.gray(`Time: ${new Date(meta.timestamp).toLocaleString()}`));
        console.log('─'.repeat(50));
        console.log(doc.substring(0, 300));
        if (doc.length > 300) {
          console.log(chalk.gray('...'));
        }
        console.log();
      }

      return results.documents[0];
    } catch (error) {
      console.error(chalk.red('Failed to search context:'), error.message);
      return [];
    }
  }

  /**
   * Track changes in the project
   */
  async trackChanges() {
    console.log(chalk.cyan('\n📝 Tracking recent changes...\n'));
    
    try {
      // Get git status
      const { stdout: gitStatus } = await execAsync('git status --short');
      if (gitStatus) {
        console.log(chalk.bold('Git Changes:'));
        console.log(gitStatus);
        
        // Store changes in ChromaDB
        await this.storeContext('file_change', `Git status:\n${gitStatus}`, {
          change_type: 'git_status',
        });
      }

      // Get recent commits
      const { stdout: gitLog } = await execAsync('git log --oneline -10');
      console.log(chalk.bold('\nRecent Commits:'));
      console.log(gitLog);

      // Check for uncommitted changes in key files
      const { stdout: diffStat } = await execAsync('git diff --stat');
      if (diffStat) {
        console.log(chalk.bold('\nUncommitted Changes:'));
        console.log(diffStat);
      }

      // Load recent file change contexts from ChromaDB
      const results = await this.collection.get({
        where: {
          user_id: this.userId,
          project_name: this.projectName,
          type: 'file_change',
          timestamp: { $gte: Date.now() - (24 * 60 * 60 * 1000) }, // Last 24 hours
        },
        include: ['documents', 'metadatas'],
        limit: 10,
      });

      if (results.documents && results.documents.length > 0) {
        console.log(chalk.bold('\n📊 Tracked Changes (Last 24h):'));
        console.log('─'.repeat(50));
        
        for (let i = 0; i < results.documents.length; i++) {
          const meta = results.metadatas[i];
          const time = new Date(meta.timestamp).toLocaleTimeString();
          console.log(chalk.gray(`[${time}]`), results.documents[i].substring(0, 100));
        }
      }

    } catch (error) {
      console.error(chalk.red('Failed to track changes:'), error.message);
    }
  }

  /**
   * Store context in ChromaDB
   */
  async storeContext(type, content, metadata = {}) {
    try {
      const contextId = `${type}_${Date.now()}_${this.userId}`;
      
      const docMetadata = {
        user_id: this.userId,
        project_name: this.projectName,
        type: type,
        timestamp: Date.now(),
        ...metadata,
      };

      await this.collection.add({
        ids: [contextId],
        documents: [content],
        metadatas: [docMetadata],
      });

      return true;
    } catch (error) {
      console.error(chalk.red(`Failed to store ${type}:`), error.message);
      return false;
    }
  }

  /**
   * Sync context with StackMemory
   */
  async syncWithStackMemory() {
    console.log(chalk.cyan('\n🔄 Syncing with StackMemory...\n'));
    
    try {
      // Get recent contexts from ChromaDB
      const contexts = await this.loadRecentContext(1); // Last hour
      
      if (contexts.length === 0) {
        console.log(chalk.yellow('No recent contexts to sync'));
        return;
      }

      // Save to StackMemory shared context
      const sharedContextDir = path.join(
        process.env.HOME,
        '.stackmemory',
        'shared-context',
        'projects'
      );
      
      if (!fs.existsSync(sharedContextDir)) {
        fs.mkdirSync(sharedContextDir, { recursive: true });
      }

      const projectFile = path.join(sharedContextDir, `${this.projectName}.json`);
      
      let projectData = {
        name: this.projectName,
        lastSync: new Date().toISOString(),
        contexts: [],
        chromadb_sync: true,
      };

      if (fs.existsSync(projectFile)) {
        projectData = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
      }

      // Add ChromaDB contexts
      projectData.contexts.push({
        source: 'chromadb',
        timestamp: Date.now(),
        count: contexts.length,
        summary: `Synced ${contexts.length} contexts from ChromaDB`,
      });

      // Keep only recent contexts (last 100)
      projectData.contexts = projectData.contexts.slice(-100);

      fs.writeFileSync(projectFile, JSON.stringify(projectData, null, 2));
      
      console.log(chalk.green(`✅ Synced ${contexts.length} contexts to StackMemory`));
      console.log(chalk.gray(`Location: ${projectFile}`));

    } catch (error) {
      console.error(chalk.red('Sync failed:'), error.message);
    }
  }

  /**
   * Generate context summary
   */
  async generateSummary() {
    console.log(chalk.cyan('\n📊 Context Summary\n'));
    
    try {
      // Get all contexts
      const results = await this.collection.get({
        where: {
          user_id: this.userId,
          project_name: this.projectName,
        },
        include: ['metadatas'],
      });

      if (!results.metadatas || results.metadatas.length === 0) {
        console.log(chalk.yellow('No contexts found'));
        return;
      }

      // Analyze contexts
      const stats = {
        total: results.metadatas.length,
        byType: {},
        byDay: {},
        oldestTimestamp: Infinity,
        newestTimestamp: 0,
      };

      for (const meta of results.metadatas) {
        // By type
        const type = meta.type || 'unknown';
        stats.byType[type] = (stats.byType[type] || 0) + 1;
        
        // By day
        const day = new Date(meta.timestamp).toLocaleDateString();
        stats.byDay[day] = (stats.byDay[day] || 0) + 1;
        
        // Time range
        if (meta.timestamp < stats.oldestTimestamp) {
          stats.oldestTimestamp = meta.timestamp;
        }
        if (meta.timestamp > stats.newestTimestamp) {
          stats.newestTimestamp = meta.timestamp;
        }
      }

      // Display summary
      console.log(chalk.bold('Context Statistics:'));
      console.log('─'.repeat(50));
      console.log(`Total Contexts: ${chalk.green(stats.total)}`);
      console.log(`Time Range: ${new Date(stats.oldestTimestamp).toLocaleDateString()} - ${new Date(stats.newestTimestamp).toLocaleDateString()}`);
      
      console.log(chalk.bold('\nBy Type:'));
      for (const [type, count] of Object.entries(stats.byType)) {
        const percentage = ((count / stats.total) * 100).toFixed(1);
        console.log(`  ${type}: ${count} (${percentage}%)`);
      }
      
      console.log(chalk.bold('\nRecent Activity:'));
      const recentDays = Object.entries(stats.byDay)
        .sort((a, b) => new Date(b[0]) - new Date(a[0]))
        .slice(0, 5);
      
      for (const [day, count] of recentDays) {
        console.log(`  ${day}: ${count} contexts`);
      }

    } catch (error) {
      console.error(chalk.red('Failed to generate summary:'), error.message);
    }
  }
}

// CLI Commands
async function main() {
  const loader = new ContextLoader();
  
  if (!await loader.initialize()) {
    process.exit(1);
  }

  const command = process.argv[2] || 'load';
  const arg = process.argv[3];

  switch (command) {
    case 'load':
      // Load recent context
      const hours = parseInt(arg) || 24;
      await loader.loadRecentContext(hours);
      break;
      
    case 'search':
    case 'query':
      // Search for specific context
      if (!arg) {
        console.log(chalk.red('Please provide a search query'));
        process.exit(1);
      }
      await loader.loadQueryContext(arg);
      break;
      
    case 'changes':
    case 'track':
      // Track recent changes
      await loader.trackChanges();
      break;
      
    case 'sync':
      // Sync with StackMemory
      await loader.syncWithStackMemory();
      break;
      
    case 'summary':
    case 'stats':
      // Generate summary
      await loader.generateSummary();
      break;
      
    case 'auto':
      // Full auto-load workflow
      console.log(chalk.bold.cyan('\n🤖 Auto-Loading Context...\n'));
      await loader.loadRecentContext(24);
      await loader.trackChanges();
      await loader.syncWithStackMemory();
      await loader.generateSummary();
      break;
      
    default:
      console.log(chalk.yellow('ChromaDB Context Loader'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log('Commands:');
      console.log('  load [hours]    - Load recent context (default: 24h)');
      console.log('  search <query>  - Search for specific context');
      console.log('  changes         - Track recent file changes');
      console.log('  sync            - Sync with StackMemory');
      console.log('  summary         - Generate context summary');
      console.log('  auto            - Run full auto-load workflow');
      console.log();
      console.log('Examples:');
      console.log('  node chromadb-context-loader.js load 48');
      console.log('  node chromadb-context-loader.js search "API implementation"');
      console.log('  node chromadb-context-loader.js auto');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}