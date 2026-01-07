#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file first
dotenv.config({ 
  path: path.join(__dirname, '..', '.env'),
  override: true // Override to ensure we use the latest key
});

async function queryLinear(query, variables = {}) {
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

async function cleanLinearBacklog() {
  const apiKey = process.env.LINEAR_API_KEY;
  
  if (!apiKey) {
    console.error('❌ LINEAR_API_KEY not found in environment');
    process.exit(1);
  }
  
  console.log('🔍 Analyzing Linear backlog...\n');
  
  try {
    // Fetch ALL issues (including completed/cancelled)
    const issuesData = await queryLinear(`
      query {
        issues(first: 250, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            description
            state {
              name
              type
            }
            priority
            priorityLabel
            team {
              key
              name
            }
            assignee {
              name
              email
            }
            createdAt
            updatedAt
            completedAt
            canceledAt
            url
          }
        }
      }
    `);
    
    const allIssues = issuesData.issues.nodes;
    console.log(`📊 Total issues found: ${allIssues.length}`);
    
    // Categorize issues
    const byStatus = {
      completed: [],
      cancelled: [],
      backlog: [],
      unstarted: [],
      started: [],
      inProgress: []
    };
    
    const duplicates = new Map(); // Track potential duplicates
    const engineeringMeetings = [];
    const testTasks = [];
    
    for (const issue of allIssues) {
      // Categorize by status
      if (issue.state.type === 'completed') {
        byStatus.completed.push(issue);
      } else if (issue.state.type === 'canceled' || issue.state.type === 'cancelled') {
        byStatus.cancelled.push(issue);
      } else if (issue.state.type === 'backlog') {
        byStatus.backlog.push(issue);
      } else if (issue.state.type === 'unstarted') {
        byStatus.unstarted.push(issue);
      } else if (issue.state.type === 'started') {
        byStatus.started.push(issue);
      }
      
      // Check for duplicates (normalize title for comparison)
      const normalizedTitle = issue.title
        .replace(/^\[[^\]]+\]\s*/, '') // Remove [ENG-XXX] prefix
        .replace(/^\[.*?\]\s*/, '') // Remove priority markers
        .trim()
        .toLowerCase();
      
      if (!duplicates.has(normalizedTitle)) {
        duplicates.set(normalizedTitle, []);
      }
      duplicates.get(normalizedTitle).push(issue);
      
      // Identify meeting tasks
      if (issue.title.includes('Engineering x') || issue.title.includes('Meeting')) {
        engineeringMeetings.push(issue);
      }
      
      // Identify test tasks
      if (issue.title.toLowerCase().includes('test') && 
          (issue.title.includes('test-') || issue.title.includes('TEST]'))) {
        testTasks.push(issue);
      }
    }
    
    // Find actual duplicates (same title appearing multiple times)
    const actualDuplicates = [];
    for (const [title, issues] of duplicates.entries()) {
      if (issues.length > 1) {
        actualDuplicates.push({ title, issues });
      }
    }
    
    // Report findings
    console.log('\n📈 Status Breakdown:');
    console.log(`  ✅ Completed: ${byStatus.completed.length}`);
    console.log(`  ❌ Cancelled: ${byStatus.cancelled.length}`);
    console.log(`  📋 Backlog: ${byStatus.backlog.length}`);
    console.log(`  ⏳ Unstarted: ${byStatus.unstarted.length}`);
    console.log(`  🔄 Started: ${byStatus.started.length}`);
    
    console.log('\n🔍 Issues to Clean:');
    console.log(`  🗓️ Engineering Meetings: ${engineeringMeetings.length}`);
    console.log(`  🧪 Test Tasks: ${testTasks.length}`);
    console.log(`  🔄 Duplicate Titles: ${actualDuplicates.length}`);
    
    // Show duplicates
    if (actualDuplicates.length > 0) {
      console.log('\n📑 Duplicate Issues:');
      for (const dup of actualDuplicates.slice(0, 10)) {
        console.log(`\n  "${dup.title}":`);
        for (const issue of dup.issues) {
          const status = issue.state.type === 'completed' ? '✅' : 
                        issue.state.type === 'cancelled' ? '❌' : '⏳';
          console.log(`    ${status} ${issue.identifier}: ${issue.state.name}`);
        }
      }
      if (actualDuplicates.length > 10) {
        console.log(`  ... and ${actualDuplicates.length - 10} more duplicate groups`);
      }
    }
    
    // Recommend deletions
    const toDelete = [];
    const toArchive = [];
    
    // Add completed issues older than 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    for (const issue of byStatus.completed) {
      if (new Date(issue.completedAt) < thirtyDaysAgo) {
        toArchive.push(issue);
      }
    }
    
    // Add all cancelled issues
    toDelete.push(...byStatus.cancelled);
    
    // Add test tasks
    toDelete.push(...testTasks.filter(t => t.state.type !== 'started'));
    
    // For duplicates, keep the most recent one
    for (const dup of actualDuplicates) {
      const sorted = dup.issues.sort((a, b) => 
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      // Mark all but the first (most recent) for deletion
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].state.type !== 'completed' && sorted[i].state.type !== 'started') {
          toDelete.push(sorted[i]);
        }
      }
    }
    
    // Remove duplicates from delete list
    const uniqueToDelete = Array.from(new Set(toDelete.map(i => i.id)))
      .map(id => toDelete.find(i => i.id === id));
    
    console.log('\n🗑️ Recommended Actions:');
    console.log(`  📁 Archive (completed >30 days): ${toArchive.length}`);
    console.log(`  🗑️ Delete (cancelled/test/duplicates): ${uniqueToDelete.length}`);
    
    if (toArchive.length > 0) {
      console.log('\n📁 Issues to Archive:');
      for (const issue of toArchive.slice(0, 5)) {
        console.log(`  - ${issue.identifier}: ${issue.title}`);
      }
      if (toArchive.length > 5) {
        console.log(`  ... and ${toArchive.length - 5} more`);
      }
    }
    
    if (uniqueToDelete.length > 0) {
      console.log('\n🗑️ Issues to Delete:');
      const deleteByReason = {
        cancelled: uniqueToDelete.filter(i => i.state.type === 'canceled' || i.state.type === 'cancelled'),
        test: uniqueToDelete.filter(i => i.title.toLowerCase().includes('test')),
        duplicate: uniqueToDelete.filter(i => 
          !i.title.toLowerCase().includes('test') && 
          i.state.type !== 'canceled' && 
          i.state.type !== 'cancelled'
        )
      };
      
      console.log(`  Cancelled: ${deleteByReason.cancelled.length}`);
      console.log(`  Test: ${deleteByReason.test.length}`);
      console.log(`  Duplicate: ${deleteByReason.duplicate.length}`);
      
      // Save deletion list
      const deletionList = uniqueToDelete.map(i => ({
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        state: i.state.type,
        reason: i.state.type === 'canceled' || i.state.type === 'cancelled' ? 'cancelled' :
                i.title.toLowerCase().includes('test') ? 'test' : 'duplicate'
      }));
      
      const filename = `linear-cleanup-${new Date().toISOString().split('T')[0]}.json`;
      fs.writeFileSync(
        path.join(__dirname, '..', filename),
        JSON.stringify(deletionList, null, 2)
      );
      console.log(`\n💾 Deletion list saved to: ${filename}`);
    }
    
    // Summary
    console.log('\n📊 Final Summary:');
    const activeIssues = allIssues.filter(i => 
      i.state.type !== 'completed' && 
      i.state.type !== 'canceled' && 
      i.state.type !== 'cancelled'
    );
    console.log(`  Current backlog size: ${activeIssues.length}`);
    console.log(`  After cleanup: ${activeIssues.length - uniqueToDelete.length}`);
    console.log(`  Reduction: ${Math.round((uniqueToDelete.length / activeIssues.length) * 100)}%`);
    
    console.log('\n💡 Next Steps:');
    console.log('  1. Review the deletion list in the JSON file');
    console.log('  2. Use Linear\'s bulk operations to archive/delete');
    console.log('  3. Run the hourly sync daemon: ./scripts/start-linear-sync-daemon.sh start');
    
  } catch (error) {
    console.error('❌ Error analyzing Linear backlog:', error.message);
  }
}

cleanLinearBacklog();