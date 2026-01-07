#!/usr/bin/env node

/**
 * Delete duplicate Linear issues identified by clean-linear-backlog.js
 * This script will delete issues from Linear using their IDs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file
dotenv.config({ 
  path: path.join(__dirname, '..', '.env'),
  override: true
});

async function mutateLinear(query, variables = {}) {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': process.env.LINEAR_API_KEY
    },
    body: JSON.stringify({ query, variables })
  });

  const data = await response.json();
  if (data.errors) {
    throw new Error(data.errors[0].message);
  }
  return data.data;
}

async function deleteLinearDuplicates() {
  const apiKey = process.env.LINEAR_API_KEY;
  
  if (!apiKey) {
    console.error('❌ LINEAR_API_KEY not found in environment');
    process.exit(1);
  }

  // Load the deletion list
  const deletionFile = path.join(__dirname, '..', 'linear-cleanup-2026-01-07.json');
  
  if (!fs.existsSync(deletionFile)) {
    console.error('❌ Deletion list not found. Run clean-linear-backlog.js first');
    process.exit(1);
  }

  const deletionList = JSON.parse(fs.readFileSync(deletionFile, 'utf8'));
  
  console.log(`🗑️  Found ${deletionList.length} issues to delete\n`);

  // Group by reason
  const byReason = {
    duplicate: deletionList.filter(i => i.reason === 'duplicate'),
    test: deletionList.filter(i => i.reason === 'test'),
    cancelled: deletionList.filter(i => i.reason === 'cancelled')
  };

  console.log('📊 Breakdown:');
  console.log(`  Duplicates: ${byReason.duplicate.length}`);
  console.log(`  Test tasks: ${byReason.test.length}`);
  console.log(`  Cancelled: ${byReason.cancelled.length}`);

  // Ask for confirmation
  console.log('\n⚠️  WARNING: This will permanently delete these issues from Linear!');
  console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
  
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('🚀 Starting deletion process...\n');

  let deleted = 0;
  let failed = 0;
  const errors = [];

  // Process in batches to avoid rate limiting
  const batchSize = 10;
  for (let i = 0; i < deletionList.length; i += batchSize) {
    const batch = deletionList.slice(i, i + batchSize);
    
    console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(deletionList.length/batchSize)}...`);
    
    for (const issue of batch) {
      try {
        // Archive instead of delete (safer)
        const result = await mutateLinear(`
          mutation ArchiveIssue($id: String!) {
            issueArchive(id: $id) {
              success
              issue {
                id
                identifier
                title
              }
            }
          }
        `, { id: issue.id });

        if (result.issueArchive.success) {
          deleted++;
          process.stdout.write('✓');
        } else {
          failed++;
          errors.push({ issue: issue.identifier, error: 'Archive failed' });
          process.stdout.write('✗');
        }
      } catch (error) {
        failed++;
        errors.push({ issue: issue.identifier, error: error.message });
        process.stdout.write('✗');
      }
    }
    
    console.log(''); // New line after batch
    
    // Rate limiting - wait between batches
    if (i + batchSize < deletionList.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log('\n📊 Final Results:');
  console.log(`  ✅ Successfully archived: ${deleted}`);
  console.log(`  ❌ Failed: ${failed}`);

  if (errors.length > 0) {
    console.log('\n❌ Errors:');
    for (const error of errors.slice(0, 10)) {
      console.log(`  - ${error.issue}: ${error.error}`);
    }
    if (errors.length > 10) {
      console.log(`  ... and ${errors.length - 10} more errors`);
    }

    // Save error log
    const errorFile = `linear-deletion-errors-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(
      path.join(__dirname, '..', errorFile),
      JSON.stringify(errors, null, 2)
    );
    console.log(`\n💾 Error log saved to: ${errorFile}`);
  }

  console.log('\n✅ Cleanup complete!');
  console.log('💡 Tip: Run sync-linear-graphql.js to update local tasks');
}

// Add dry run option
const isDryRun = process.argv.includes('--dry-run');

if (isDryRun) {
  console.log('🔍 DRY RUN MODE - No changes will be made\n');
  
  const deletionFile = path.join(__dirname, '..', 'linear-cleanup-2026-01-07.json');
  const deletionList = JSON.parse(fs.readFileSync(deletionFile, 'utf8'));
  
  console.log('Would delete:');
  const byTitle = {};
  for (const issue of deletionList) {
    const title = issue.title.substring(0, 50);
    if (!byTitle[title]) {
      byTitle[title] = 0;
    }
    byTitle[title]++;
  }
  
  const sorted = Object.entries(byTitle).sort((a, b) => b[1] - a[1]);
  for (const [title, count] of sorted.slice(0, 15)) {
    console.log(`  ${count}x ${title}...`);
  }
  
  process.exit(0);
}

deleteLinearDuplicates();