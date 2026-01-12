#!/usr/bin/env tsx

/**
 * Test ChromaDB synchronization and upload local contexts
 */

import { ChromaClient } from 'chromadb';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testChromaDBConnection() {
  const apiKey = process.env.CHROMADB_API_KEY;
  const tenant = process.env.CHROMADB_TENANT;
  const database = process.env.CHROMADB_DATABASE || 'stackmemory';
  
  if (!apiKey || !tenant) {
    console.error('❌ Missing ChromaDB credentials in .env');
    console.log('   CHROMADB_API_KEY:', apiKey ? '✓ Set' : '✗ Missing');
    console.log('   CHROMADB_TENANT:', tenant ? '✓ Set' : '✗ Missing');
    console.log('   CHROMADB_DATABASE:', database);
    return null;
  }

  console.log('🔄 Connecting to ChromaDB Cloud...');
  console.log('   Tenant:', tenant);
  console.log('   Database:', database);
  
  try {
    // Create ChromaDB client for cloud using new API
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

    // Test connection
    const heartbeat = await client.heartbeat();
    console.log('✅ ChromaDB connection successful:', heartbeat);
    
    return client;
  } catch (error: unknown) {
    console.error('❌ Failed to connect to ChromaDB:', (error as Error).message);
    return null;
  }
}

async function getOrCreateCollection(client: ChromaClient) {
  const collectionName = 'stackmemory_contexts';
  
  try {
    // Try to get existing collection
    const collections = await client.listCollections();
    console.log('📚 Existing collections:', collections.map((c: any) => c.name).join(', ') || 'none');
    
    // Get or create the collection
    const collection = await client.getOrCreateCollection({
      name: collectionName,
      metadata: {
        description: 'StackMemory context storage',
        created_by: 'test-chromadb-sync',
        version: '2.0.0'
      }
    });
    
    console.log(`✅ Collection '${collectionName}' ready`);
    
    // Get collection count
    const count = await collection.count();
    console.log(`   Current entries: ${count}`);
    
    return collection;
  } catch (error: unknown) {
    console.error('❌ Failed to create/get collection:', (error as Error).message);
    return null;
  }
}

async function loadLocalContexts() {
  const storageFile = path.join(os.homedir(), '.stackmemory', 'context-storage', 'contexts.jsonl');
  
  if (!fs.existsSync(storageFile)) {
    console.log('⚠️  No local contexts found');
    return [];
  }
  
  const contexts: any[] = [];
  const fileStream = fs.createReadStream(storageFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.trim()) {
      try {
        contexts.push(JSON.parse(line));
      } catch (error) {
        console.warn('Failed to parse line:', line.substring(0, 50));
      }
    }
  }
  
  console.log(`📁 Loaded ${contexts.length} local contexts`);
  return contexts;
}

async function syncContextsToChromaDB(collection: any, contexts: any[]) {
  console.log(`\n🔄 Syncing ${contexts.length} contexts to ChromaDB...`);
  
  let synced = 0;
  let failed = 0;
  
  // Batch upload for efficiency
  const batchSize = 10;
  for (let i = 0; i < contexts.length; i += batchSize) {
    const batch = contexts.slice(i, Math.min(i + batchSize, contexts.length));
    
    const ids: string[] = [];
    const documents: string[] = [];
    const metadatas: any[] = [];
    
    for (const ctx of batch) {
      ids.push(ctx.id || `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
      documents.push(ctx.content || JSON.stringify(ctx));
      
      // Prepare metadata
      const metadata: any = {
        timestamp: ctx.timestamp || ctx.stored_at || new Date().toISOString(),
        type: ctx.type || 'context',
        user_id: ctx.user_id || process.env.USER || 'default',
        project: ctx.project || 'stackmemory'
      };
      
      // Add additional metadata if present
      if (ctx.session_id) metadata.session_id = ctx.session_id;
      if (ctx.metadata) {
        Object.entries(ctx.metadata).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            metadata[key] = String(value);
          }
        });
      }
      
      metadatas.push(metadata);
    }
    
    try {
      await collection.upsert({
        ids,
        documents,
        metadatas
      });
      synced += batch.length;
      console.log(`   ✓ Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} contexts synced`);
    } catch (error: unknown) {
      failed += batch.length;
      console.error(`   ✗ Batch ${Math.floor(i / batchSize) + 1} failed:`, (error as Error).message);
    }
  }
  
  console.log(`\n📊 Sync complete:`);
  console.log(`   ✅ Synced: ${synced}`);
  console.log(`   ❌ Failed: ${failed}`);
  
  return { synced, failed };
}

async function queryRecentContexts(collection: any) {
  console.log('\n🔍 Querying recent contexts...');
  
  try {
    // Query for recent contexts
    const results = await collection.query({
      queryTexts: ['task complete code change'],
      nResults: 5
    });
    
    if (results.ids && results.ids[0].length > 0) {
      console.log(`Found ${results.ids[0].length} relevant contexts:`);
      
      for (let i = 0; i < results.ids[0].length; i++) {
        const metadata = results.metadatas[0][i];
        const document = results.documents[0][i];
        console.log(`\n📄 Context ${i + 1}:`);
        console.log(`   ID: ${results.ids[0][i]}`);
        console.log(`   Type: ${metadata.type}`);
        console.log(`   Timestamp: ${metadata.timestamp}`);
        console.log(`   Content: ${document.substring(0, 100)}...`);
      }
    } else {
      console.log('No contexts found');
    }
  } catch (error: unknown) {
    console.error('Failed to query contexts:', (error as Error).message);
  }
}

async function main() {
  console.log('🚀 ChromaDB Sync Test\n');
  
  // Connect to ChromaDB
  const client = await testChromaDBConnection();
  if (!client) {
    console.error('\n❌ Cannot proceed without ChromaDB connection');
    console.log('\n📝 To fix:');
    console.log('1. Ensure you have a ChromaDB Cloud account');
    console.log('2. Add credentials to .env:');
    console.log('   CHROMADB_API_KEY=your-api-key');
    console.log('   CHROMADB_TENANT=your-tenant-id');
    console.log('   CHROMADB_DATABASE=stackmemory');
    process.exit(1);
  }
  
  // Get or create collection
  const collection = await getOrCreateCollection(client);
  if (!collection) {
    process.exit(1);
  }
  
  // Load local contexts
  const contexts = await loadLocalContexts();
  
  if (contexts.length > 0) {
    // Sync to ChromaDB
    await syncContextsToChromaDB(collection, contexts);
  }
  
  // Query recent contexts
  await queryRecentContexts(collection);
  
  console.log('\n✅ Test complete!');
}

main().catch(console.error);