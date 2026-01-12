#!/usr/bin/env node

/**
 * Analyze Linear workspace for duplicate tasks to identify what to delete
 */

import 'dotenv/config';
import { LinearRestClient } from '../dist/integrations/linear/rest-client.js';
import fs from 'fs';

const API_KEY = process.env.LINEAR_API_KEY;
if (!API_KEY) {
  console.error('❌ LINEAR_API_KEY environment variable not set');
  console.log('Please set LINEAR_API_KEY in your .env file or export it in your shell');
  process.exit(1);
}

async function analyzeLinearDuplicates() {
  try {
    console.log('🔍 Analyzing Linear workspace for duplicates and low-value tasks...\n');
    
    const client = new LinearRestClient(API_KEY);
    
    // Fetch all tasks
    console.log('📥 Fetching all tasks from Linear...');
    const allTasks = await client.getAllTasks(true);
    console.log(`📊 Total tasks: ${allTasks.length}\n`);
    
    // Analyze patterns
    const duplicates = new Map(); // title pattern -> tasks
    const meetingTasks = [];
    const todoTasks = [];
    const analyticsDashboardTasks = [];
    const phaseImportTasks = [];
    const completedTasks = [];
    const canceledTasks = [];
    
    // Group tasks by patterns
    allTasks.forEach(task => {
      const title = task.title;
      const state = task.state.type;
      
      // Check for completed/canceled
      if (state === 'completed') {
        completedTasks.push(task);
      } else if (state === 'canceled') {
        canceledTasks.push(task);
      }
      
      // Engineering meetings pattern
      if (title.includes('Engineering x') && title.includes('Meeting')) {
        meetingTasks.push(task);
      }
      
      // Documentation TODOs pattern
      if (title.includes('Complete Documentation TODOs')) {
        todoTasks.push(task);
      }
      
      // Task Analytics Dashboard pattern
      if (title.includes('Task Analytics Dashboard')) {
        analyticsDashboardTasks.push(task);
      }
      
      // Phase tasks with duplicate numbers
      if (title.match(/\[STA-\d+\]/)) {
        const match = title.match(/\[(STA-\d+)\]/);
        if (match) {
          const innerRef = match[1];
          if (!phaseImportTasks[innerRef]) {
            phaseImportTasks[innerRef] = [];
          }
          phaseImportTasks[innerRef].push(task);
        }
      }
      
      // Find exact duplicates by title
      const baseTitle = title.replace(/\[.*?\]/g, '').trim();
      if (!duplicates.has(baseTitle)) {
        duplicates.set(baseTitle, []);
      }
      duplicates.get(baseTitle).push(task);
    });
    
    // Filter to only show actual duplicates
    const trueDuplicates = Array.from(duplicates.entries())
      .filter(([_, tasks]) => tasks.length > 1)
      .sort((a, b) => b[1].length - a[1].length);
    
    // Generate report
    console.log('📋 DUPLICATE ANALYSIS REPORT');
    console.log('=' .repeat(60));
    
    console.log('\n🔄 EXACT DUPLICATES (same title):');
    console.log(`Found ${trueDuplicates.length} duplicate groups\n`);
    trueDuplicates.slice(0, 10).forEach(([title, tasks]) => {
      console.log(`  "${title}" - ${tasks.length} copies`);
      tasks.slice(0, 3).forEach(task => {
        console.log(`    • ${task.identifier}: ${task.state.name}`);
      });
    });
    
    console.log('\n🏢 ENGINEERING MEETINGS:');
    console.log(`Found ${meetingTasks.length} meeting tasks`);
    if (meetingTasks.length > 0) {
      console.log('Examples:');
      meetingTasks.slice(0, 5).forEach(task => {
        console.log(`  • ${task.identifier}: ${task.title}`);
      });
    }
    
    console.log('\n📝 DOCUMENTATION TODO DUPLICATES:');
    console.log(`Found ${todoTasks.length} TODO tasks`);
    if (todoTasks.length > 0) {
      console.log('Examples:');
      todoTasks.slice(0, 5).forEach(task => {
        console.log(`  • ${task.identifier}: ${task.title}`);
      });
    }
    
    console.log('\n📊 TASK ANALYTICS DASHBOARD DUPLICATES:');
    console.log(`Found ${analyticsDashboardTasks.length} analytics dashboard tasks`);
    if (analyticsDashboardTasks.length > 0) {
      console.log('Examples:');
      analyticsDashboardTasks.slice(0, 5).forEach(task => {
        console.log(`  • ${task.identifier}: ${task.title}`);
      });
    }
    
    console.log('\n✅ COMPLETED TASKS (can be archived):');
    console.log(`Found ${completedTasks.length} completed tasks`);
    
    console.log('\n❌ CANCELED TASKS (can be deleted):');
    console.log(`Found ${canceledTasks.length} canceled tasks`);
    
    // Calculate deletion recommendations
    const toDelete = [
      ...meetingTasks,
      ...todoTasks.slice(1), // Keep one TODO task
      ...analyticsDashboardTasks.slice(1), // Keep one dashboard task
      ...canceledTasks,
      ...completedTasks
    ];
    
    // Remove duplicates from deletion list
    const uniqueToDelete = Array.from(new Set(toDelete.map(t => t.id)))
      .map(id => toDelete.find(t => t.id === id));
    
    console.log('\n🗑️  DELETION RECOMMENDATIONS');
    console.log('=' .repeat(60));
    console.log(`Total tasks to delete: ${uniqueToDelete.length}`);
    console.log(`Space to be freed: ${uniqueToDelete.length} issues`);
    console.log(`Remaining after deletion: ${allTasks.length - uniqueToDelete.length} issues\n`);
    
    // Group by category for deletion
    const deleteCategories = {
      'Engineering Meetings': meetingTasks.map(t => t.identifier),
      'Duplicate TODOs': todoTasks.slice(1).map(t => t.identifier),
      'Duplicate Dashboards': analyticsDashboardTasks.slice(1).map(t => t.identifier),
      'Completed Tasks': completedTasks.map(t => t.identifier),
      'Canceled Tasks': canceledTasks.map(t => t.identifier)
    };
    
    console.log('📝 Tasks to delete by category:\n');
    Object.entries(deleteCategories).forEach(([category, tasks]) => {
      if (tasks.length > 0) {
        console.log(`${category} (${tasks.length} tasks):`);
        console.log(`  ${tasks.slice(0, 10).join(', ')}${tasks.length > 10 ? '...' : ''}\n`);
      }
    });
    
    // Save deletion list to file
    const deleteList = {
      timestamp: new Date().toISOString(),
      summary: {
        total: allTasks.length,
        toDelete: uniqueToDelete.length,
        remaining: allTasks.length - uniqueToDelete.length
      },
      categories: deleteCategories,
      tasks: uniqueToDelete.map(t => ({
        id: t.id,
        identifier: t.identifier,
        title: t.title,
        state: t.state.name
      }))
    };
    
    const filename = `linear-deletion-list-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(filename, JSON.stringify(deleteList, null, 2));
    console.log(`💾 Deletion list saved to: ${filename}\n`);
    
    console.log('🎯 NEXT STEPS:');
    console.log('1. Review the deletion list above');
    console.log('2. Run the delete script to remove these tasks');
    console.log('3. Then add the new phase tasks\n');
    
    console.log('To delete these tasks, run:');
    console.log('  node scripts/delete-linear-tasks.js\n');
    
    return deleteList;
    
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  analyzeLinearDuplicates().catch(console.error);
}

export { analyzeLinearDuplicates };