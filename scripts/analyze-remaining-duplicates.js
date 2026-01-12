#!/usr/bin/env node

/**
 * Analyze remaining tasks after first deletion round
 */

import 'dotenv/config';
import fs from 'fs';

const API_KEY = process.env.LINEAR_OAUTH_TOKEN || process.env.LINEAR_API_KEY;
if (!API_KEY) {
  console.error('❌ LINEAR_OAUTH_TOKEN or LINEAR_API_KEY environment variable not set');
  console.log('Please set LINEAR_OAUTH_TOKEN or LINEAR_API_KEY in your .env file or export it in your shell');
  process.exit(1);
}

async function fetchAllIssues() {
  const query = `
    query GetAllIssues($after: String) {
      issues(first: 100, after: $after, includeArchived: false) {
        nodes {
          id
          identifier
          title
          description
          state {
            id
            name
            type
          }
          createdAt
          updatedAt
          priority
          estimate
          project {
            id
            name
          }
          team {
            id
            key
            name
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;
  
  let allIssues = [];
  let hasNextPage = true;
  let cursor = null;
  
  while (hasNextPage) {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        variables: { after: cursor }
      })
    });
    
    const result = await response.json();
    
    if (result.errors) {
      throw new Error(result.errors[0].message);
    }
    
    allIssues = allIssues.concat(result.data.issues.nodes);
    hasNextPage = result.data.issues.pageInfo.hasNextPage;
    cursor = result.data.issues.pageInfo.endCursor;
    
    console.log(`  Fetched ${allIssues.length} issues...`);
  }
  
  return allIssues;
}

async function analyzeRemainingDuplicates() {
  try {
    console.log('🔍 Analyzing remaining tasks for duplicates...\n');
    console.log('📥 Fetching all tasks from Linear...');
    
    const allTasks = await fetchAllIssues();
    console.log(`📊 Total tasks remaining: ${allTasks.length}\n`);
    
    // Group by normalized title to find duplicates
    const titleGroups = new Map();
    
    allTasks.forEach(task => {
      // Normalize title for comparison
      const normalizedTitle = task.title
        .toLowerCase()
        .replace(/\[.*?\]/g, '') // Remove brackets
        .replace(/sta-\d+/gi, '') // Remove STA references
        .replace(/eng-\d+/gi, '') // Remove ENG references
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
      
      if (!titleGroups.has(normalizedTitle)) {
        titleGroups.set(normalizedTitle, []);
      }
      titleGroups.get(normalizedTitle).push(task);
    });
    
    // Find groups with duplicates
    const duplicateGroups = Array.from(titleGroups.entries())
      .filter(([_, tasks]) => tasks.length > 1)
      .sort((a, b) => b[1].length - a[1].length);
    
    console.log('📋 REMAINING DUPLICATES ANALYSIS');
    console.log('=' .repeat(60));
    
    console.log(`\nFound ${duplicateGroups.length} groups of duplicates:\n`);
    
    let totalDuplicates = 0;
    const tasksToDelete = [];
    
    duplicateGroups.forEach(([title, tasks]) => {
      console.log(`\n"${title.substring(0, 60)}..." - ${tasks.length} copies:`);
      
      // Sort by status and date to determine which to keep
      const sorted = tasks.sort((a, b) => {
        // Keep in-progress tasks
        if (a.state.type === 'started') return -1;
        if (b.state.type === 'started') return 1;
        // Keep newer tasks
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });
      
      sorted.forEach((task, index) => {
        const keep = index === 0 ? '✅ KEEP' : '❌ DELETE';
        console.log(`  ${keep} ${task.identifier}: ${task.state.name}`);
        
        if (index > 0) {
          tasksToDelete.push(task);
          totalDuplicates++;
        }
      });
    });
    
    // Look for specific patterns that might have been missed
    console.log('\n\n🔍 CHECKING SPECIFIC PATTERNS:');
    
    const patterns = [
      'Enable TypeScript Strict Mode',
      'TypeScript Strict Mode',
      'strict mode',
      'Enhanced CLI Commands',
      'CLI Commands',
      'Performance Optimization',
      'Error Handling',
      'Security Audit',
      'Testing Suite',
      'Refactor Large Files'
    ];
    
    patterns.forEach(pattern => {
      const matches = allTasks.filter(task => 
        task.title.toLowerCase().includes(pattern.toLowerCase())
      );
      
      if (matches.length > 1) {
        console.log(`\n"${pattern}": ${matches.length} tasks found`);
        matches.forEach(task => {
          console.log(`  • ${task.identifier}: ${task.title.substring(0, 60)}...`);
        });
      }
    });
    
    console.log('\n\n🎯 DELETION SUMMARY');
    console.log('=' .repeat(60));
    console.log(`Current tasks: ${allTasks.length}`);
    console.log(`Additional duplicates to delete: ${totalDuplicates}`);
    console.log(`Tasks after cleanup: ${allTasks.length - totalDuplicates}`);
    
    // Save deletion list
    const deleteList = {
      timestamp: new Date().toISOString(),
      summary: {
        currentTotal: allTasks.length,
        toDelete: totalDuplicates,
        afterDeletion: allTasks.length - totalDuplicates
      },
      duplicateGroups: duplicateGroups.map(([title, tasks]) => ({
        title,
        count: tasks.length,
        tasks: tasks.map(t => ({
          id: t.id,
          identifier: t.identifier,
          title: t.title,
          state: t.state.name
        }))
      })),
      tasks: tasksToDelete.map(t => ({
        id: t.id,
        identifier: t.identifier,
        title: t.title,
        state: t.state.name
      }))
    };
    
    const filename = `remaining-duplicates-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(filename, JSON.stringify(deleteList, null, 2));
    
    console.log(`\n💾 Deletion list saved to: ${filename}`);
    console.log('\nTo delete these remaining duplicates, run:');
    console.log('  node scripts/delete-remaining-duplicates.js\n');
    
    return deleteList;
    
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  analyzeRemainingDuplicates().catch(console.error);
}

export { analyzeRemainingDuplicates };