#!/usr/bin/env tsx

/**
 * Query ChromaDB for stored contexts
 */

import { ChromaClient } from 'chromadb';
import dotenv from 'dotenv';
import chalk from 'chalk';

// Load environment variables
dotenv.config();

async function queryChromaDB() {
  const apiKey = process.env.CHROMADB_API_KEY;
  const tenant = process.env.CHROMADB_TENANT;
  const database = process.env.CHROMADB_DATABASE || 'stackmemory';

  console.log(chalk.cyan('🔍 Querying ChromaDB Contexts\n'));

  // Connect to ChromaDB
  const client = new ChromaClient({
    ssl: true,
    host: 'api.trychroma.com',
    port: 443,
    headers: {
      'X-Chroma-Token': apiKey
    },
    tenant: tenant,
    database: database
  });

  // List all collections first
  const collections = await client.listCollections();
  console.log(chalk.yellow('📚 Available Collections:'));
  collections.forEach(col => {
    console.log(`   - ${col.name}`);
  });
  console.log();

  // Get collection - try claude_context first (from hooks), then stackmemory_contexts
  let collection;
  try {
    collection = await client.getCollection({
      name: 'claude_context'
    });
    console.log(chalk.green('✓ Using collection: claude_context\n'));
  } catch {
    collection = await client.getCollection({
      name: 'stackmemory_contexts'
    });
    console.log(chalk.green('✓ Using collection: stackmemory_contexts\n'));
  }

  console.log(chalk.yellow('📊 Collection Stats:'));
  const count = await collection.count();
  console.log(`   Total documents: ${count}\n`);

  // Query 1: Get all documents
  console.log(chalk.cyan('📚 All Stored Contexts:\n'));
  
  const allDocs = await collection.get({
    limit: 100
  });

  if (allDocs.ids.length > 0) {
    for (let i = 0; i < allDocs.ids.length; i++) {
      const metadata = allDocs.metadatas[i];
      const document = allDocs.documents[i];
      
      console.log(chalk.green(`${i + 1}. ${allDocs.ids[i]}`));
      console.log(`   Type: ${metadata.type}`);
      console.log(`   Timestamp: ${metadata.timestamp}`);
      console.log(`   User: ${metadata.user_id}`);
      console.log(`   Project: ${metadata.project}`);
      console.log(`   Content: ${document?.substring(0, 100)}...`);
      console.log();
    }
  }

  // Query 2: Search for specific content
  console.log(chalk.cyan('\n🔎 Search Results for "TypeScript lint error":\n'));
  
  const searchResults = await collection.query({
    queryTexts: ['TypeScript lint error fix'],
    nResults: 5
  });

  if (searchResults.ids[0].length > 0) {
    for (let i = 0; i < searchResults.ids[0].length; i++) {
      const metadata = searchResults.metadatas[0][i];
      const document = searchResults.documents[0][i];
      const distance = searchResults.distances[0][i];
      
      console.log(chalk.yellow(`Match ${i + 1} (distance: ${distance.toFixed(3)}):`));
      console.log(`   ID: ${searchResults.ids[0][i]}`);
      console.log(`   Type: ${metadata.type}`);
      console.log(`   Timestamp: ${metadata.timestamp}`);
      console.log(`   Content: ${document?.substring(0, 150)}...`);
      console.log();
    }
  } else {
    console.log('No results found');
  }

  // Query 3: Filter by metadata
  console.log(chalk.cyan('\n📋 Recent Task Completions:\n'));
  
  const taskCompletions = await collection.get({
    where: {
      type: 'task_complete'
    },
    limit: 10
  });

  if (taskCompletions.ids.length > 0) {
    for (let i = 0; i < taskCompletions.ids.length; i++) {
      const metadata = taskCompletions.metadatas[i];
      const document = taskCompletions.documents[i];
      
      console.log(chalk.green(`Task ${i + 1}:`));
      console.log(`   ID: ${taskCompletions.ids[i]}`);
      console.log(`   Timestamp: ${metadata.timestamp}`);
      console.log(`   Task ID: ${metadata.task_id}`);
      console.log(`   Duration: ${metadata.duration}ms`);
      console.log(`   Files Changed: ${metadata.files_changed}`);
      console.log(`   Content: ${document?.substring(0, 100)}...`);
      console.log();
    }
  } else {
    console.log('No task completions found');
  }

  // Query 4: Get periodic saves
  console.log(chalk.cyan('\n⏰ Periodic Checkpoints:\n'));
  
  const periodicSaves = await collection.get({
    where: {
      type: 'periodic_save'
    },
    limit: 10
  });

  if (periodicSaves.ids.length > 0) {
    for (let i = 0; i < periodicSaves.ids.length; i++) {
      const metadata = periodicSaves.metadatas[i];
      const document = periodicSaves.documents[i];
      
      console.log(chalk.blue(`Checkpoint ${i + 1}:`));
      console.log(`   Timestamp: ${metadata.timestamp}`);
      console.log(`   Interval: ${metadata.interval}`);
      console.log(`   Active Files: ${metadata.active_files}`);
      console.log(`   Git Status: ${document?.substring(0, 150)}...`);
      console.log();
    }
  } else {
    console.log('No periodic saves found');
  }

  // Query 5: Get decisions
  console.log(chalk.cyan('\n💡 Decisions Made:\n'));
  
  const decisions = await collection.get({
    where: {
      type: 'decision_made'
    },
    limit: 10
  });

  if (decisions.ids.length > 0) {
    for (let i = 0; i < decisions.ids.length; i++) {
      const metadata = decisions.metadatas[i];
      const document = decisions.documents[i];
      
      console.log(chalk.magenta(`Decision ${i + 1}:`));
      console.log(`   Category: ${metadata.category}`);
      console.log(`   Alternatives: ${metadata.alternatives}`);
      console.log(`   Reasoning: ${metadata.reasoning}`);
      console.log(`   Decision: ${document?.substring(0, 200)}...`);
      console.log();
    }
  } else {
    console.log('No decisions found');
  }

  // Query 6: Group by type
  console.log(chalk.cyan('\n📈 Context Types Summary:\n'));
  
  const types = new Map();
  for (let i = 0; i < allDocs.ids.length; i++) {
    const type = allDocs.metadatas[i].type || 'unknown';
    types.set(type, (types.get(type) || 0) + 1);
  }

  for (const [type, count] of types.entries()) {
    console.log(`   ${type}: ${count} documents`);
  }
}

// Run query
queryChromaDB().catch(console.error);