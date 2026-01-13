#!/usr/bin/env node

import 'dotenv/config';
import { RecursiveAgentOrchestrator } from '../dist/skills/recursive-agent-orchestrator.js';
import { FrameManager } from '../dist/core/context/frame-manager.js';
import { DualStackManager } from '../dist/core/context/dual-stack-manager.js';
import { ContextRetriever } from '../dist/core/retrieval/context-retriever.js';
import { PebblesTaskStore } from '../dist/features/tasks/pebbles-task-store.js';
import { SQLiteAdapter } from '../dist/core/database/sqlite-adapter.js';
import { ClaudeCodeSubagentClient } from '../dist/integrations/claude-code/subagent-client.js';
import * as path from 'path';
import * as os from 'os';

async function testRLM() {
  console.log('🚀 Testing RLM Orchestrator...\n');
  
  try {
    // Initialize dependencies
    const projectId = 'test-project';
    const userId = 'test-user';
    const dbPath = path.join(os.tmpdir(), 'test-rlm.db');
    
    console.log('📦 Initializing components...');
    const database = new SQLiteAdapter(projectId, { dbPath });
    await database.connect();
    
    const dualStackManager = new DualStackManager(database, projectId, userId);
    const frameManager = dualStackManager.getActiveStack();
    const contextRetriever = new ContextRetriever(database);
    
    // Initialize task store with projectId
    const taskStorePath = path.join(os.tmpdir(), 'test-tasks');
    const taskStore = new PebblesTaskStore(projectId, taskStorePath);
    
    // Initialize RLM Orchestrator
    console.log('🤖 Creating RLM Orchestrator...');
    const rlm = new RecursiveAgentOrchestrator(
      frameManager,
      dualStackManager,
      contextRetriever,
      taskStore
    );
    
    // Test with a simple task
    const task = 'Create a simple hello world function in JavaScript';
    console.log(`\n📝 Task: "${task}"\n`);
    
    const options = {
      maxParallel: 2,
      maxRecursionDepth: 2,
      reviewStages: 1,
      qualityThreshold: 0.7,
      testGenerationMode: 'unit',
      verboseLogging: true,
    };
    
    console.log('⚙️  Options:', JSON.stringify(options, null, 2));
    console.log('\n🔄 Executing RLM...\n');
    
    const result = await rlm.execute(task, options);
    
    if (result.success) {
      console.log('✅ RLM Execution Successful!\n');
      console.log('📊 Results:');
      console.log(`  - Total tokens: ${result.data.totalTokens}`);
      console.log(`  - Estimated cost: $${result.data.totalCost.toFixed(4)}`);
      console.log(`  - Duration: ${result.data.duration}ms`);
      console.log(`  - Tests generated: ${result.data.testsGenerated}`);
      console.log(`  - Issues found: ${result.data.issuesFound}`);
      console.log(`  - Issues fixed: ${result.data.issuesFixed}`);
      
      if (result.data.improvements?.length > 0) {
        console.log('\n🔧 Improvements:');
        result.data.improvements.forEach(imp => {
          console.log(`  • ${imp}`);
        });
      }
      
      console.log('\n🌳 Execution Tree:');
      printTaskTree(result.data.rootNode, 0);
    } else {
      console.log('❌ RLM Execution Failed');
      console.log('Error:', result.message);
    }
    
    // Cleanup
    await database.disconnect();
    console.log('\n✨ Test complete!');
    
  } catch (error) {
    console.error('💥 Test failed:', error);
    process.exit(1);
  }
}

function printTaskTree(node, depth = 0) {
  const indent = '  '.repeat(depth);
  const status = node.status === 'completed' ? '✓' : 
                 node.status === 'failed' ? '✗' : 
                 node.status === 'running' ? '⟳' : '○';
  
  console.log(`${indent}${status} ${node.description} [${node.agent}]`);
  
  if (node.children) {
    node.children.forEach(child => printTaskTree(child, depth + 1));
  }
}

// Run the test
testRLM().catch(console.error);