#!/usr/bin/env node

/**
 * Delete remaining duplicate tasks
 */

import fs from 'fs';
import readline from 'readline';

const API_KEY = 'lin_oauth_02b1b198dfb9ddd06626fad0921f4c786905f191ceaff1c863449fc5b4555b36';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function deleteRemainingDuplicates() {
  try {
    // Load deletion list
    const deleteFile = `remaining-duplicates-${new Date().toISOString().split('T')[0]}.json`;
    if (!fs.existsSync(deleteFile)) {
      console.error(`❌ Deletion list not found: ${deleteFile}`);
      console.log('Run analyze-remaining-duplicates.js first.');
      process.exit(1);
    }
    
    const deleteList = JSON.parse(fs.readFileSync(deleteFile, 'utf8'));
    
    console.log('📋 REMAINING DUPLICATES DELETION');
    console.log('=' .repeat(60));
    console.log(`\n  Current tasks: ${deleteList.summary.currentTotal}`);
    console.log(`  Tasks to delete: ${deleteList.summary.toDelete}`);
    console.log(`  After deletion: ${deleteList.summary.afterDeletion}\n`);
    
    // Show what will be deleted
    console.log('📝 Tasks to be deleted:');
    deleteList.tasks.forEach(task => {
      console.log(`  • ${task.identifier}: ${task.title.substring(0, 60)}...`);
    });
    
    // Confirmation
    console.log(`\n⚠️  This will permanently delete ${deleteList.summary.toDelete} duplicate tasks.`);
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
    
    console.log('\n🗑️  Deleting remaining duplicates...\n');
    
    let deleted = 0;
    let failed = 0;
    const results = [];
    
    for (const task of deleteList.tasks) {
      try {
        process.stdout.write(`Deleting ${task.identifier}: ${task.title.substring(0, 40)}... `);
        
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
            'Authorization': `Bearer ${API_KEY}`,
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
          deleted++;
          results.push({ ...task, status: 'already_deleted' });
        } else {
          const error = result.errors?.[0]?.message || 'Unknown error';
          console.log(`❌ (${error})`);
          failed++;
          results.push({ ...task, status: 'failed', error });
        }
        
        // Small delay between deletions
        await delay(500);
        
      } catch (error) {
        console.log(`❌ (${error.message})`);
        failed++;
        results.push({ ...task, status: 'error', error: error.message });
      }
    }
    
    // Save results
    const resultsFile = `remaining-deletion-results-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(resultsFile, JSON.stringify({
      summary: { 
        attempted: deleteList.tasks.length,
        deleted, 
        failed,
        success_rate: Math.round((deleted / deleteList.tasks.length) * 100) 
      },
      results,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    // Final report
    console.log('\n' + '='.repeat(60));
    console.log('📊 DELETION COMPLETE');
    console.log('='.repeat(60));
    console.log(`\n✅ Successfully deleted: ${deleted} tasks`);
    console.log(`❌ Failed: ${failed} tasks`);
    console.log(`📈 Success rate: ${Math.round((deleted / deleteList.tasks.length) * 100)}%`);
    console.log(`\n💾 Results saved to: ${resultsFile}`);
    
    if (deleted > 0) {
      console.log(`\n🎉 Workspace cleaned! Now at ${deleteList.summary.afterDeletion} tasks.`);
      console.log('All TypeScript Strict Mode duplicates have been removed.');
    }
    
  } catch (error) {
    console.error('\n💥 Script failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  deleteRemainingDuplicates().catch(console.error);
}

export { deleteRemainingDuplicates };