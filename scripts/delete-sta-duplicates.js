#!/usr/bin/env node

/**
 * Delete duplicate STA tasks from Linear to free up capacity
 */

import fs from 'fs';
import readline from 'readline';

// Use env var or fallback
const API_KEY = process.env.LINEAR_API_KEY || 'REMOVED_LINEAR_API_KEY';
const BATCH_SIZE = 10; // Delete in batches to avoid rate limits
const DELAY_BETWEEN_BATCHES = 3000; // 3 seconds between batches

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function deleteSTATasks() {
  try {
    // Load deletion list
    const deleteFile = `sta-deletion-list-${new Date().toISOString().split('T')[0]}.json`;
    if (!fs.existsSync(deleteFile)) {
      console.error(`❌ Deletion list not found: ${deleteFile}`);
      console.log('Run analyze-sta-graphql.js first to generate the list.');
      process.exit(1);
    }
    
    const deleteList = JSON.parse(fs.readFileSync(deleteFile, 'utf8'));
    
    console.log('📋 STA TASK DELETION SUMMARY');
    console.log('=' .repeat(60));
    console.log(`\n  Total workspace tasks: ${deleteList.summary.totalWorkspace}`);
    console.log(`  Current STA tasks: ${deleteList.summary.totalSTA}`);
    console.log(`  Tasks to delete: ${deleteList.summary.toDelete}`);
    console.log(`  Workspace after deletion: ${deleteList.summary.remainingTotal}`);
    console.log(`\n  🎯 Capacity to be freed: ${deleteList.summary.capacityFreed} task slots\n`);
    
    // Show breakdown
    console.log('📝 Tasks to delete by category:');
    Object.entries(deleteList.categories).forEach(([category, tasks]) => {
      if (tasks.length > 0) {
        console.log(`  • ${category}: ${tasks.length} tasks`);
      }
    });
    
    // Safety confirmation
    console.log('\n⚠️  WARNING: This will permanently delete ${deleteList.summary.toDelete} tasks from Linear!');
    console.log('This action cannot be undone. Make sure you have reviewed the list.\n');
    console.log('Type "DELETE STA TASKS" to confirm, or press Ctrl+C to cancel:\n');
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const confirmation = await new Promise(resolve => {
      rl.question('Confirmation: ', resolve);
    });
    rl.close();
    
    if (confirmation !== 'DELETE STA TASKS') {
      console.log('❌ Deletion cancelled');
      process.exit(0);
    }
    
    console.log('\n🗑️  Starting deletion process...');
    console.log(`Will delete in batches of ${BATCH_SIZE} with ${DELAY_BETWEEN_BATCHES/1000}s delay\n`);
    
    let deleted = 0;
    let failed = 0;
    let alreadyDeleted = 0;
    const results = [];
    const errors = [];
    
    // Process in batches
    for (let i = 0; i < deleteList.tasks.length; i += BATCH_SIZE) {
      const batch = deleteList.tasks.slice(i, i + BATCH_SIZE);
      console.log(`\n📦 Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(deleteList.tasks.length/BATCH_SIZE)}`);
      
      for (const task of batch) {
        try {
          process.stdout.write(`  Deleting ${task.identifier}: ${task.title.substring(0, 40)}... `);
          
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
            console.log('✅');
            deleted++;
            results.push({ ...task, status: 'deleted' });
          } else if (result.errors?.[0]?.message?.includes('not found')) {
            console.log('⚠️  (already gone)');
            alreadyDeleted++;
            results.push({ ...task, status: 'already_deleted' });
          } else {
            const error = result.errors?.[0]?.message || 'Unknown error';
            console.log(`❌ (${error})`);
            failed++;
            errors.push({ ...task, error });
            results.push({ ...task, status: 'failed', error });
          }
          
        } catch (error) {
          console.log(`❌ (${error.message})`);
          failed++;
          errors.push({ ...task, error: error.message });
          results.push({ ...task, status: 'error', error: error.message });
          
          // If rate limited, wait longer
          if (error.message?.includes('rate') || error.message?.includes('429')) {
            console.log('⏳ Rate limited. Waiting 30 seconds...');
            await delay(30000);
          }
        }
      }
      
      // Progress update
      const total = deleted + alreadyDeleted + failed;
      const percent = Math.round((total / deleteList.tasks.length) * 100);
      console.log(`\n📊 Progress: ${total}/${deleteList.tasks.length} (${percent}%)`);
      console.log(`   ✅ Deleted: ${deleted} | ⚠️  Already gone: ${alreadyDeleted} | ❌ Failed: ${failed}`);
      
      // Delay before next batch
      if (i + BATCH_SIZE < deleteList.tasks.length) {
        console.log(`⏳ Waiting ${DELAY_BETWEEN_BATCHES/1000}s before next batch...`);
        await delay(DELAY_BETWEEN_BATCHES);
      }
    }
    
    // Save results
    const resultsFile = `sta-deletion-results-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(resultsFile, JSON.stringify({
      summary: { 
        attempted: deleteList.tasks.length,
        deleted, 
        alreadyDeleted,
        failed, 
        success_rate: Math.round(((deleted + alreadyDeleted) / deleteList.tasks.length) * 100) 
      },
      results,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    // Final report
    console.log('\n' + '='.repeat(60));
    console.log('📊 DELETION COMPLETE');
    console.log('='.repeat(60));
    console.log(`\n✅ Successfully deleted: ${deleted} tasks`);
    console.log(`⚠️  Already deleted: ${alreadyDeleted} tasks`);
    console.log(`❌ Failed: ${failed} tasks`);
    console.log(`📈 Success rate: ${Math.round(((deleted + alreadyDeleted) / deleteList.tasks.length) * 100)}%`);
    console.log(`\n💾 Results saved to: ${resultsFile}`);
    
    const totalFreed = deleted + alreadyDeleted;
    if (totalFreed > 0) {
      console.log(`\n🎉 Freed up ${totalFreed} task slots in your Linear workspace!`);
      console.log('\nYour workspace now has capacity for new tasks.');
      console.log('The backlog has been cleaned of duplicates and similar tasks.');
    }
    
    if (failed > 0) {
      console.log(`\n⚠️  ${failed} tasks could not be deleted. Check ${resultsFile} for details.`);
    }
    
  } catch (error) {
    console.error('\n💥 Script failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  deleteSTATasks().catch(console.error);
}

export { deleteSTATasks };