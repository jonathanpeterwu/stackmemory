#!/usr/bin/env node

/**
 * Delete duplicate and low-value tasks from Linear to free up capacity
 */

import 'dotenv/config';
import fs from 'fs';
import readline from 'readline';

const API_KEY = process.env.LINEAR_API_KEY;
if (!API_KEY) {
  console.error('❌ LINEAR_API_KEY environment variable not set');
  console.log('Please set LINEAR_API_KEY in your .env file or export it in your shell');
  process.exit(1);
}
const DELAY_BETWEEN_DELETES = 2000; // 2 seconds to avoid rate limits

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function deleteLinearTasks() {
  try {
    // Load deletion list
    const deleteFile = `linear-deletion-list-${new Date().toISOString().split('T')[0]}.json`;
    if (!fs.existsSync(deleteFile)) {
      console.error(`❌ Deletion list not found: ${deleteFile}`);
      console.log('Run analyze-linear-duplicates.js first to generate the list.');
      process.exit(1);
    }
    
    const deleteList = JSON.parse(fs.readFileSync(deleteFile, 'utf8'));
    console.log('📋 Deletion Summary:');
    console.log(`  Total tasks in workspace: ${deleteList.summary.total}`);
    console.log(`  Tasks to delete: ${deleteList.summary.toDelete}`);
    console.log(`  Tasks remaining after: ${deleteList.summary.remaining}\n`);
    
    // Show categories
    console.log('📝 Tasks to delete by category:');
    Object.entries(deleteList.categories).forEach(([category, tasks]) => {
      if (tasks.length > 0) {
        console.log(`  • ${category}: ${tasks.length} tasks`);
      }
    });
    
    // Confirm deletion
    console.log('\n⚠️  WARNING: This will permanently delete these tasks from Linear!');
    console.log('Type "DELETE" to confirm, or press Ctrl+C to cancel:\n');
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const confirmation = await new Promise(resolve => {
      rl.question('Confirmation: ', resolve);
    });
    rl.close();
    
    if (confirmation !== 'DELETE') {
      console.log('❌ Deletion cancelled');
      process.exit(0);
    }
    
    console.log('\n🗑️  Starting deletion process...\n');
    
    let deleted = 0;
    let failed = 0;
    const results = [];
    
    // Process tasks in batches
    for (const task of deleteList.tasks) {
      try {
        console.log(`Deleting ${task.identifier}: ${task.title.substring(0, 50)}...`);
        
        const deleteQuery = `
          mutation DeleteIssue($id: String!) {
            issueDelete(id: $id) {
              success
            }
          }
        `;
        
        const response = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            'Authorization': API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query: deleteQuery,
            variables: { id: task.id }
          })
        });
        
        const result = await response.json();
        
        if (result.data?.issueDelete?.success) {
          console.log(`  ✅ Deleted ${task.identifier}`);
          deleted++;
          results.push({ ...task, deleted: true });
        } else if (result.errors?.[0]?.message?.includes('not found')) {
          console.log(`  ⚠️  ${task.identifier} already deleted or not found`);
          deleted++; // Count as successful since it's gone
          results.push({ ...task, deleted: true, note: 'Already deleted' });
        } else {
          throw new Error(result.errors?.[0]?.message || 'Unknown error');
        }
        
        // Delay to avoid rate limits
        if (deleted < deleteList.tasks.length) {
          await delay(DELAY_BETWEEN_DELETES);
        }
        
        // Show progress every 10 tasks
        if (deleted % 10 === 0) {
          console.log(`\n📊 Progress: ${deleted}/${deleteList.tasks.length} deleted\n`);
        }
        
      } catch (error) {
        console.log(`  ❌ Failed to delete ${task.identifier}: ${error.message}`);
        failed++;
        results.push({ ...task, deleted: false, error: error.message });
        
        // If rate limited, wait longer
        if (error.message?.includes('rate limit') || error.message?.includes('usage limit')) {
          console.log('⏳ Hit rate limit. Waiting 30 seconds...');
          await delay(30000);
        }
      }
    }
    
    // Save results
    const resultsFile = `linear-deletion-results-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(resultsFile, JSON.stringify({
      summary: { deleted, failed, total: deleteList.tasks.length },
      results,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 DELETION COMPLETE');
    console.log('='.repeat(60));
    console.log(`✅ Successfully deleted: ${deleted} tasks`);
    console.log(`❌ Failed: ${failed} tasks`);
    console.log(`📈 Success rate: ${Math.round((deleted / deleteList.tasks.length) * 100)}%`);
    console.log(`💾 Results saved to: ${resultsFile}\n`);
    
    if (deleted > 0) {
      console.log('🎉 Workspace capacity freed! You can now add the new phase tasks.');
      console.log('\nNext steps:');
      console.log('1. Run: node scripts/add-phase-tasks-to-linear.js');
      console.log('2. Start implementing Phase 2 high-priority tasks');
    }
    
  } catch (error) {
    console.error('💥 Script failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  deleteLinearTasks().catch(console.error);
}

export { deleteLinearTasks };