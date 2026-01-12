#!/usr/bin/env node

/**
 * Comprehensive ChromaDB integration test
 */

import { ChromaDBContextSaver, TRIGGER_EVENTS } from '../.claude/hooks/chromadb-save-hook.js';
import chalk from 'chalk';

async function testAllEventTypes() {
  const saver = new ChromaDBContextSaver();
  
  console.log(chalk.cyan('\n🧪 Testing ChromaDB Context Saving\n'));
  
  // Test different event types
  const testCases = [
    {
      event: TRIGGER_EVENTS.TASK_COMPLETE,
      data: {
        task: 'Fix TypeScript and lint errors',
        taskId: 'STA-293',
        duration: 1200000,
        filesChanged: ['src/skills/claude-skills.ts', 'src/cli/index.ts']
      }
    },
    {
      event: TRIGGER_EVENTS.CODE_CHANGE,
      data: {
        files: ['src/core/storage/chromadb-simple.ts'],
        linesAdded: 45,
        linesRemoved: 23
      }
    },
    {
      event: TRIGGER_EVENTS.TEST_RUN,
      data: {
        total: 421,
        passed: 421,
        failed: 0,
        coverage: 87.5
      }
    },
    {
      event: TRIGGER_EVENTS.DECISION_MADE,
      data: {
        decision: 'Use ChromaDB Cloud for context persistence',
        category: 'architecture',
        alternatives: ['Local SQLite', 'Redis', 'PostgreSQL'],
        reasoning: 'Cloud-based solution provides better persistence and sharing'
      }
    },
    {
      event: TRIGGER_EVENTS.PERIODIC_SAVE,
      data: {
        interval: '15m',
        activeFiles: ['scripts/test-chromadb-sync.ts']
      }
    }
  ];
  
  let successCount = 0;
  let failCount = 0;
  
  for (const testCase of testCases) {
    console.log(chalk.yellow(`\n📝 Testing: ${testCase.event}`));
    console.log(chalk.gray(`   Data: ${JSON.stringify(testCase.data).substring(0, 100)}...`));
    
    try {
      const result = await saver.saveContext(testCase.event, testCase.data);
      if (result && result.success) {
        console.log(chalk.green(`   ✅ Saved successfully: ${result.id}`));
        successCount++;
      } else {
        console.log(chalk.red(`   ❌ Save failed: ${result?.error || 'Unknown error'}`));
        failCount++;
      }
    } catch (error) {
      console.log(chalk.red(`   ❌ Error: ${error.message}`));
      failCount++;
    }
  }
  
  // Load recent contexts
  console.log(chalk.cyan('\n🔍 Loading recent contexts...'));
  const recentContexts = await saver.loadRecentContext(1); // Last hour
  
  console.log(chalk.blue(`\n📊 Summary:`));
  console.log(`   Saved: ${successCount}/${testCases.length}`);
  console.log(`   Failed: ${failCount}/${testCases.length}`);
  console.log(`   Recent contexts found: ${recentContexts.length}`);
  
  // Display recent contexts
  if (recentContexts.length > 0) {
    console.log(chalk.cyan('\n📚 Recent Contexts:'));
    recentContexts.slice(0, 5).forEach((ctx, i) => {
      console.log(`\n   ${i + 1}. ${ctx.type || 'unknown'} - ${new Date(ctx.timestamp).toLocaleString()}`);
      console.log(`      ${ctx.content?.substring(0, 80)}...`);
    });
  }
  
  return successCount === testCases.length;
}

// Run tests
testAllEventTypes().then(success => {
  if (success) {
    console.log(chalk.green('\n✅ All tests passed! ChromaDB integration is working.'));
  } else {
    console.log(chalk.yellow('\n⚠️  Some tests failed, but ChromaDB is partially working.'));
  }
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error(chalk.red('\n❌ Test failed:'), error);
  process.exit(1);
});