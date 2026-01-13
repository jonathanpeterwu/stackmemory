#!/usr/bin/env node

import 'dotenv/config';
import { ClaudeCodeSubagentClient } from '../dist/integrations/claude-code/subagent-client.js';

async function testRLMSimple() {
  console.log('🚀 Testing RLM Subagent Client (Simple Mode)...\n');
  
  try {
    // Initialize the subagent client
    console.log('🤖 Creating Subagent Client...');
    const client = new ClaudeCodeSubagentClient();
    
    // Test with different subagent types
    const testCases = [
      {
        type: 'planning',
        task: 'Create a simple hello world function',
        context: { language: 'JavaScript', style: 'functional' }
      },
      {
        type: 'code',
        task: 'Implement a hello world function in JavaScript',
        context: { requirements: 'Should return "Hello, World!"' }
      },
      {
        type: 'testing',
        task: 'Generate tests for a hello world function',
        context: { code: 'function hello() { return "Hello, World!"; }' }
      }
    ];
    
    for (const testCase of testCases) {
      console.log(`\n📝 Testing ${testCase.type} subagent:`);
      console.log(`   Task: "${testCase.task}"`);
      
      // Use mock mode for testing
      const result = await client.mockTaskToolExecution({
        type: testCase.type,
        task: testCase.task,
        context: testCase.context
      });
      
      if (result.success) {
        console.log(`   ✅ Success!`);
        console.log(`   ⏱️  Duration: ${result.duration}ms`);
        console.log(`   📊 Tokens: ~${result.tokens || 'N/A'}`);
        
        if (testCase.type === 'planning' && result.result?.tasks) {
          console.log(`   📋 Generated ${result.result.tasks.length} subtasks`);
        } else if (testCase.type === 'code' && result.result?.implementation) {
          console.log(`   💻 Generated code (${result.result.implementation.length} chars)`);
        } else if (testCase.type === 'testing' && result.result?.tests) {
          console.log(`   🧪 Generated ${result.result.tests.length} test cases`);
        }
      } else {
        console.log(`   ❌ Failed: ${result.error}`);
      }
    }
    
    console.log('\n\n🎯 Testing Parallel Execution:');
    const parallelRequests = [
      { type: 'code', task: 'Create add function', context: {} },
      { type: 'code', task: 'Create subtract function', context: {} },
      { type: 'testing', task: 'Test math functions', context: {} }
    ];
    
    console.log(`   Executing ${parallelRequests.length} subagents in parallel...`);
    const startTime = Date.now();
    
    const results = await client.executeParallel(
      parallelRequests.map(req => ({ ...req, type: req.type }))
    );
    
    const duration = Date.now() - startTime;
    const successful = results.filter(r => r.success).length;
    
    console.log(`   ⏱️  Completed in ${duration}ms`);
    console.log(`   ✅ ${successful}/${results.length} successful`);
    
    console.log('\n✨ Test complete!');
    
  } catch (error) {
    console.error('💥 Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testRLMSimple().catch(console.error);