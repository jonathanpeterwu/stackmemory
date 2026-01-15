#!/usr/bin/env node

/**
 * Analyze Linear workspace for STA duplicates using GraphQL API directly
 */

import 'dotenv/config';
import fs from 'fs';

// Load API key from environment
const API_KEY = process.env.LINEAR_API_KEY;
if (!API_KEY) {
  console.error('❌ LINEAR_API_KEY environment variable not set');
  console.log('Please set LINEAR_API_KEY in your .env file or export it in your shell');
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
        'Authorization': API_KEY,
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

async function analyzeSTADuplicates() {
  try {
    console.log('🔍 Analyzing Linear workspace for STA duplicates and unneeded tasks...\n');
    console.log('📥 Fetching all tasks from Linear (using GraphQL)...');
    
    const allTasks = await fetchAllIssues();
    console.log(`📊 Total tasks in workspace: ${allTasks.length}\n`);
    
    // Filter STA tasks
    const staTasks = allTasks.filter(task => 
      task.identifier.startsWith('STA-') || 
      task.title.includes('STA-') ||
      task.title.includes('[STA-')
    );
    
    console.log(`📌 Found ${staTasks.length} STA-related tasks\n`);
    
    // Analyze patterns
    const staByNumber = new Map();
    const completedSTA = [];
    const canceledSTA = [];
    const duplicateTitles = new Map();
    const lowValuePatterns = [];
    const backlogSTA = [];
    const todoSTA = [];
    const inProgressSTA = [];
    
    // Group tasks by patterns
    staTasks.forEach(task => {
      const state = task.state.type;
      const status = task.state.name;
      
      // Extract STA number
      const staMatch = task.identifier.match(/STA-(\d+)/);
      if (staMatch) {
        const staNum = parseInt(staMatch[1]);
        if (!staByNumber.has(staNum)) {
          staByNumber.set(staNum, []);
        }
        staByNumber.get(staNum).push(task);
      }
      
      // Check state
      if (state === 'completed') {
        completedSTA.push(task);
      } else if (state === 'canceled') {
        canceledSTA.push(task);
      } else if (state === 'backlog' || status === 'Backlog') {
        backlogSTA.push(task);
      } else if (state === 'started' || status === 'In Progress') {
        inProgressSTA.push(task);
      } else if (state === 'unstarted' || state === 'triage' || status === 'Todo') {
        todoSTA.push(task);
      }
      
      // Check for low-value patterns
      const lowValueKeywords = [
        'Documentation TODO',
        'Meeting',
        'Task Analytics Dashboard',
        'Weekly Sync',
        'Standup',
        '[Duplicate]',
        'Test Task',
        'Demo Task',
        'Example Task'
      ];
      
      if (lowValueKeywords.some(keyword => task.title.includes(keyword)) ||
          task.description?.includes('auto-generated') ||
          task.description?.includes('automatically created')) {
        lowValuePatterns.push(task);
      }
      
      // Find duplicate titles
      const baseTitle = task.title
        .replace(/\[.*?\]/g, '')
        .replace(/STA-\d+/g, '')
        .trim()
        .toLowerCase();
      
      if (baseTitle.length > 10) { // Only consider meaningful titles
        if (!duplicateTitles.has(baseTitle)) {
          duplicateTitles.set(baseTitle, []);
        }
        duplicateTitles.get(baseTitle).push(task);
      }
    });
    
    // Find true duplicates
    const duplicateSTANumbers = Array.from(staByNumber.entries())
      .filter(([_, tasks]) => tasks.length > 1)
      .sort((a, b) => b[1].length - a[1].length);
    
    const trueDuplicateTitles = Array.from(duplicateTitles.entries())
      .filter(([_, tasks]) => tasks.length > 1)
      .sort((a, b) => b[1].length - a[1].length);
    
    // Generate report
    console.log('📋 STA TASK ANALYSIS REPORT');
    console.log('=' .repeat(60));
    
    console.log('\n📊 OVERVIEW:');
    console.log(`Total workspace tasks: ${allTasks.length}`);
    console.log(`STA-prefixed tasks: ${staTasks.length} (${Math.round(staTasks.length / allTasks.length * 100)}% of workspace)`);
    console.log(`\nStatus breakdown:`);
    console.log(`  • In Progress: ${inProgressSTA.length}`);
    console.log(`  • Todo/Ready: ${todoSTA.length}`);
    console.log(`  • Backlog: ${backlogSTA.length}`);
    console.log(`  • Completed: ${completedSTA.length}`);
    console.log(`  • Canceled: ${canceledSTA.length}`);
    
    if (duplicateSTANumbers.length > 0) {
      console.log('\n🔄 DUPLICATE STA NUMBERS:');
      console.log(`Found ${duplicateSTANumbers.length} STA numbers with multiple tasks:\n`);
      duplicateSTANumbers.forEach(([staNum, tasks]) => {
        console.log(`  STA-${staNum} has ${tasks.length} instances:`);
        tasks.forEach(task => {
          console.log(`    • ${task.identifier}: "${task.title.substring(0, 60)}..." (${task.state.name})`);
        });
      });
    }
    
    if (trueDuplicateTitles.length > 0) {
      console.log('\n📝 SIMILAR TITLES (potential duplicates):');
      console.log(`Found ${trueDuplicateTitles.length} groups of similar titles:\n`);
      trueDuplicateTitles.slice(0, 15).forEach(([title, tasks]) => {
        console.log(`  "${title.substring(0, 50)}..." appears ${tasks.length} times:`);
        tasks.slice(0, 5).forEach(task => {
          console.log(`    • ${task.identifier}: ${task.state.name}`);
        });
      });
    }
    
    if (lowValuePatterns.length > 0) {
      console.log('\n🗑️ LOW-VALUE/AUTO-GENERATED TASKS:');
      console.log(`Found ${lowValuePatterns.length} potentially low-value tasks:\n`);
      const categories = {
        'Meeting/Sync tasks': lowValuePatterns.filter(t => 
          t.title.includes('Meeting') || t.title.includes('Sync') || t.title.includes('Standup')),
        'Documentation TODOs': lowValuePatterns.filter(t => 
          t.title.includes('Documentation TODO')),
        'Test/Demo tasks': lowValuePatterns.filter(t => 
          t.title.includes('Test Task') || t.title.includes('Demo') || t.title.includes('Example')),
        'Auto-generated': lowValuePatterns.filter(t => 
          t.description?.includes('auto-generated') || t.description?.includes('automatically'))
      };
      
      Object.entries(categories).forEach(([category, tasks]) => {
        if (tasks.length > 0) {
          console.log(`  ${category}: ${tasks.length} tasks`);
          tasks.slice(0, 5).forEach(task => {
            console.log(`    • ${task.identifier}: ${task.title.substring(0, 50)}...`);
          });
        }
      });
    }
    
    // Build deletion recommendations
    const toDelete = new Set();
    
    // Add duplicates (keep most recent or in-progress)
    duplicateSTANumbers.forEach(([_, tasks]) => {
      const sorted = tasks.sort((a, b) => {
        if (a.state.type === 'started') return -1;
        if (b.state.type === 'started') return 1;
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });
      sorted.slice(1).forEach(t => toDelete.add(t));
    });
    
    // Add similar titles (be more conservative)
    trueDuplicateTitles.forEach(([_, tasks]) => {
      if (tasks.every(t => t.state.type !== 'started')) {
        // If none are in progress, keep newest
        const sorted = tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        sorted.slice(1).forEach(t => toDelete.add(t));
      }
    });
    
    // Add completed and canceled
    completedSTA.forEach(t => toDelete.add(t));
    canceledSTA.forEach(t => toDelete.add(t));
    
    // Add clear low-value patterns
    lowValuePatterns.forEach(task => {
      if (task.state.type !== 'started' && 
          (task.title.includes('[Duplicate]') || 
           task.title.includes('Test Task') ||
           task.description?.includes('auto-generated'))) {
        toDelete.add(task);
      }
    });
    
    const uniqueToDelete = Array.from(toDelete)
      .sort((a, b) => {
        const aNum = parseInt(a.identifier.replace('STA-', ''));
        const bNum = parseInt(b.identifier.replace('STA-', ''));
        return aNum - bNum;
      });
    
    console.log('\n🎯 DELETION RECOMMENDATIONS');
    console.log('=' .repeat(60));
    console.log(`\nCapacity Analysis:`);
    console.log(`  Current workspace total: ${allTasks.length} tasks`);
    console.log(`  Current STA tasks: ${staTasks.length}`);
    console.log(`  Recommended to delete: ${uniqueToDelete.length} tasks`);
    console.log(`  Workspace after deletion: ${allTasks.length - uniqueToDelete.length} tasks`);
    console.log(`  STA tasks after deletion: ${staTasks.length - uniqueToDelete.length}`);
    console.log(`  **Capacity freed: ${uniqueToDelete.length} task slots**`);
    
    // Categorize deletions
    const deleteReasons = {
      'Duplicate STA numbers': [],
      'Similar/duplicate titles': [],
      'Completed tasks': [],
      'Canceled tasks': [],
      'Low-value/auto-generated': []
    };
    
    uniqueToDelete.forEach(task => {
      let categorized = false;
      
      // Check if it's a duplicate STA number
      const staMatch = task.identifier.match(/STA-(\d+)/);
      if (staMatch) {
        const staNum = parseInt(staMatch[1]);
        const dupes = staByNumber.get(staNum);
        if (dupes && dupes.length > 1 && dupes[0].id !== task.id) {
          deleteReasons['Duplicate STA numbers'].push(task);
          categorized = true;
        }
      }
      
      if (!categorized && completedSTA.find(t => t.id === task.id)) {
        deleteReasons['Completed tasks'].push(task);
        categorized = true;
      }
      
      if (!categorized && canceledSTA.find(t => t.id === task.id)) {
        deleteReasons['Canceled tasks'].push(task);
        categorized = true;
      }
      
      if (!categorized && lowValuePatterns.find(t => t.id === task.id)) {
        deleteReasons['Low-value/auto-generated'].push(task);
        categorized = true;
      }
      
      if (!categorized) {
        deleteReasons['Similar/duplicate titles'].push(task);
      }
    });
    
    console.log('\n📝 Deletion breakdown by reason:');
    Object.entries(deleteReasons).forEach(([reason, tasks]) => {
      if (tasks.length > 0) {
        console.log(`\n${reason}: ${tasks.length} tasks`);
        const preview = tasks.slice(0, 10)
          .map(t => `${t.identifier}`)
          .join(', ');
        console.log(`  ${preview}${tasks.length > 10 ? ` ... +${tasks.length - 10} more` : ''}`);
      }
    });
    
    // Save deletion list
    const deleteList = {
      timestamp: new Date().toISOString(),
      summary: {
        totalWorkspace: allTasks.length,
        totalSTA: staTasks.length,
        toDelete: uniqueToDelete.length,
        capacityFreed: uniqueToDelete.length,
        remainingSTA: staTasks.length - uniqueToDelete.length,
        remainingTotal: allTasks.length - uniqueToDelete.length
      },
      categories: Object.entries(deleteReasons).reduce((acc, [reason, tasks]) => {
        acc[reason] = tasks.map(t => t.identifier);
        return acc;
      }, {}),
      tasks: uniqueToDelete.map(t => ({
        id: t.id,
        identifier: t.identifier,
        title: t.title,
        state: t.state.name,
        team: t.team?.name || 'No team'
      }))
    };
    
    const filename = `sta-deletion-list-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(filename, JSON.stringify(deleteList, null, 2));
    
    console.log(`\n💾 Deletion list saved to: ${filename}`);
    console.log('\n✅ Ready to free up capacity!');
    console.log('\nNext: Create a deletion script or manually review the JSON file');
    
    return deleteList;
    
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      console.error('\n⚠️  Authentication failed. Please check your LINEAR_API_KEY');
    }
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  analyzeSTADuplicates().catch(console.error);
}

export { analyzeSTADuplicates };