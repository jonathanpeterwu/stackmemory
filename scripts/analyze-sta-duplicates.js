#!/usr/bin/env node

/**
 * Analyze Linear workspace specifically for STA duplicate tasks
 */

import { LinearRestClient } from '../dist/integrations/linear/rest-client.js';
import fs from 'fs';

// Use env var or fallback
const API_KEY = process.env.LINEAR_API_KEY || 'REMOVED_LINEAR_API_KEY';

async function analyzeSTADuplicates() {
  try {
    console.log('🔍 Analyzing Linear workspace for STA duplicates and unneeded tasks...\n');
    
    const client = new LinearRestClient(API_KEY);
    
    // Fetch all tasks
    console.log('📥 Fetching all tasks from Linear...');
    const allTasks = await client.getAllTasks(true);
    console.log(`📊 Total tasks in workspace: ${allTasks.length}\n`);
    
    // Filter STA tasks
    const staTasks = allTasks.filter(task => 
      task.identifier.startsWith('STA-') || 
      task.title.includes('STA-') ||
      task.title.includes('[STA-')
    );
    
    console.log(`📌 Found ${staTasks.length} STA-related tasks\n`);
    
    // Analyze patterns
    const staByNumber = new Map(); // STA number -> tasks
    const completedSTA = [];
    const canceledSTA = [];
    const duplicateTitles = new Map();
    const lowValuePatterns = [];
    const backlogSTA = [];
    const todoSTA = [];
    
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
      
      // Check for completed/canceled
      if (state === 'completed') {
        completedSTA.push(task);
      } else if (state === 'canceled') {
        canceledSTA.push(task);
      } else if (state === 'backlog' || status === 'Backlog') {
        backlogSTA.push(task);
      } else if (state === 'triage' || status === 'Triage' || status === 'Todo') {
        todoSTA.push(task);
      }
      
      // Check for low-value patterns
      if (task.title.includes('Documentation TODO') ||
          task.title.includes('Meeting') ||
          task.title.includes('Task Analytics Dashboard') ||
          task.title.includes('Weekly Sync') ||
          task.title.includes('Standup') ||
          task.title.includes('[Duplicate]') ||
          task.title.includes('Test Task') ||
          task.description?.includes('auto-generated')) {
        lowValuePatterns.push(task);
      }
      
      // Find duplicate titles
      const baseTitle = task.title.replace(/\[.*?\]/g, '').trim().toLowerCase();
      if (!duplicateTitles.has(baseTitle)) {
        duplicateTitles.set(baseTitle, []);
      }
      duplicateTitles.get(baseTitle).push(task);
    });
    
    // Find true duplicates (same STA number)
    const duplicateSTANumbers = Array.from(staByNumber.entries())
      .filter(([_, tasks]) => tasks.length > 1)
      .sort((a, b) => b[1].length - a[1].length);
    
    // Find duplicate titles
    const trueDuplicateTitles = Array.from(duplicateTitles.entries())
      .filter(([_, tasks]) => tasks.length > 1)
      .sort((a, b) => b[1].length - a[1].length);
    
    // Generate report
    console.log('📋 STA DUPLICATE ANALYSIS REPORT');
    console.log('=' .repeat(60));
    
    console.log('\n📊 SUMMARY:');
    console.log(`Total tasks: ${allTasks.length}`);
    console.log(`STA tasks: ${staTasks.length}`);
    console.log(`Completed STA: ${completedSTA.length}`);
    console.log(`Canceled STA: ${canceledSTA.length}`);
    console.log(`Backlog STA: ${backlogSTA.length}`);
    console.log(`Todo/Triage STA: ${todoSTA.length}`);
    console.log(`Low-value patterns: ${lowValuePatterns.length}`);
    
    console.log('\n🔄 DUPLICATE STA NUMBERS:');
    if (duplicateSTANumbers.length > 0) {
      console.log(`Found ${duplicateSTANumbers.length} STA numbers with duplicates:\n`);
      duplicateSTANumbers.slice(0, 10).forEach(([staNum, tasks]) => {
        console.log(`  STA-${staNum} - ${tasks.length} copies:`);
        tasks.forEach(task => {
          console.log(`    • ${task.identifier}: "${task.title.substring(0, 50)}..." (${task.state.name})`);
        });
      });
    } else {
      console.log('No duplicate STA numbers found');
    }
    
    console.log('\n📝 DUPLICATE TITLES:');
    if (trueDuplicateTitles.length > 0) {
      console.log(`Found ${trueDuplicateTitles.length} duplicate title groups:\n`);
      trueDuplicateTitles.slice(0, 10).forEach(([title, tasks]) => {
        console.log(`  "${title.substring(0, 50)}..." - ${tasks.length} copies:`);
        tasks.slice(0, 3).forEach(task => {
          console.log(`    • ${task.identifier}: ${task.state.name}`);
        });
      });
    }
    
    console.log('\n🗑️ LOW-VALUE PATTERNS:');
    if (lowValuePatterns.length > 0) {
      console.log(`Found ${lowValuePatterns.length} low-value tasks:\n`);
      const patterns = {
        'Documentation TODOs': lowValuePatterns.filter(t => t.title.includes('Documentation TODO')),
        'Meeting tasks': lowValuePatterns.filter(t => t.title.includes('Meeting')),
        'Analytics Dashboard': lowValuePatterns.filter(t => t.title.includes('Task Analytics Dashboard')),
        'Test/Auto-generated': lowValuePatterns.filter(t => t.title.includes('Test Task') || t.description?.includes('auto-generated'))
      };
      
      Object.entries(patterns).forEach(([category, tasks]) => {
        if (tasks.length > 0) {
          console.log(`  ${category}: ${tasks.length} tasks`);
          tasks.slice(0, 3).forEach(task => {
            console.log(`    • ${task.identifier}: ${task.title.substring(0, 50)}...`);
          });
        }
      });
    }
    
    // Build deletion list
    const toDelete = [];
    
    // Add duplicates (keep the first one of each group)
    duplicateSTANumbers.forEach(([_, tasks]) => {
      // Keep the one that's in progress or most recently updated
      const sorted = tasks.sort((a, b) => {
        if (a.state.type === 'started') return -1;
        if (b.state.type === 'started') return 1;
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });
      toDelete.push(...sorted.slice(1)); // Delete all but the first
    });
    
    // Add completed and canceled
    toDelete.push(...completedSTA);
    toDelete.push(...canceledSTA);
    
    // Add low-value patterns (but not if they're already in the list)
    lowValuePatterns.forEach(task => {
      if (!toDelete.find(t => t.id === task.id)) {
        toDelete.push(task);
      }
    });
    
    // Remove duplicates from deletion list
    const uniqueToDelete = Array.from(new Set(toDelete.map(t => t.id)))
      .map(id => toDelete.find(t => t.id === id))
      .sort((a, b) => {
        const aNum = parseInt(a.identifier.replace('STA-', ''));
        const bNum = parseInt(b.identifier.replace('STA-', ''));
        return aNum - bNum;
      });
    
    console.log('\n🎯 DELETION RECOMMENDATIONS');
    console.log('=' .repeat(60));
    console.log(`Total STA tasks: ${staTasks.length}`);
    console.log(`Tasks to delete: ${uniqueToDelete.length}`);
    console.log(`STA tasks remaining: ${staTasks.length - uniqueToDelete.length}`);
    console.log(`Total workspace after deletion: ${allTasks.length - uniqueToDelete.length}\n`);
    
    // Group deletions by reason
    const deleteCategories = {
      'Duplicate STA Numbers': [],
      'Completed Tasks': [],
      'Canceled Tasks': [],
      'Low-Value Patterns': []
    };
    
    uniqueToDelete.forEach(task => {
      if (completedSTA.find(t => t.id === task.id)) {
        deleteCategories['Completed Tasks'].push(task.identifier);
      } else if (canceledSTA.find(t => t.id === task.id)) {
        deleteCategories['Canceled Tasks'].push(task.identifier);
      } else if (lowValuePatterns.find(t => t.id === task.id)) {
        deleteCategories['Low-Value Patterns'].push(task.identifier);
      } else {
        deleteCategories['Duplicate STA Numbers'].push(task.identifier);
      }
    });
    
    console.log('📝 Tasks to delete by category:\n');
    Object.entries(deleteCategories).forEach(([category, tasks]) => {
      if (tasks.length > 0) {
        console.log(`${category} (${tasks.length} tasks):`);
        const preview = tasks.slice(0, 20).join(', ');
        console.log(`  ${preview}${tasks.length > 20 ? ` ... and ${tasks.length - 20} more` : ''}\n`);
      }
    });
    
    // Show what will remain
    const remaining = staTasks.filter(t => !uniqueToDelete.find(d => d.id === t.id));
    const inProgress = remaining.filter(t => t.state.type === 'started');
    const todo = remaining.filter(t => t.state.type === 'unstarted' && t.state.name !== 'Backlog');
    
    console.log('✅ WHAT WILL REMAIN:');
    console.log(`${remaining.length} STA tasks total:`);
    console.log(`  • In Progress: ${inProgress.length} tasks`);
    console.log(`  • Todo/Ready: ${todo.length} tasks`);
    console.log(`  • Backlog: ${remaining.filter(t => t.state.name === 'Backlog').length} tasks\n`);
    
    // Save deletion list to file
    const deleteList = {
      timestamp: new Date().toISOString(),
      summary: {
        totalWorkspace: allTasks.length,
        totalSTA: staTasks.length,
        toDelete: uniqueToDelete.length,
        remainingSTA: staTasks.length - uniqueToDelete.length,
        remainingTotal: allTasks.length - uniqueToDelete.length
      },
      categories: deleteCategories,
      tasks: uniqueToDelete.map(t => ({
        id: t.id,
        identifier: t.identifier,
        title: t.title,
        state: t.state.name,
        reason: completedSTA.find(c => c.id === t.id) ? 'completed' :
                canceledSTA.find(c => c.id === t.id) ? 'canceled' :
                lowValuePatterns.find(l => l.id === t.id) ? 'low-value' : 'duplicate'
      }))
    };
    
    const filename = `sta-deletion-list-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(filename, JSON.stringify(deleteList, null, 2));
    console.log(`💾 Deletion list saved to: ${filename}\n`);
    
    console.log('🎯 NEXT STEPS:');
    console.log('1. Review the deletion list above');
    console.log('2. Run the delete script to remove these tasks');
    console.log(`3. This will free up ${uniqueToDelete.length} tasks worth of capacity\n`);
    
    console.log('To delete these tasks, run:');
    console.log('  node scripts/delete-sta-tasks.js\n');
    
    return deleteList;
    
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    if (error.message.includes('401')) {
      console.error('\n⚠️  Authentication failed. Check your LINEAR_API_KEY');
    }
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  analyzeSTADuplicates().catch(console.error);
}

export { analyzeSTADuplicates };