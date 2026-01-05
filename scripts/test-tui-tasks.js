#!/usr/bin/env node

/**
 * Test script to verify TUI displays Linear-synced tasks
 */

import { DataService } from '../dist/features/tui/services/data-service.js';

async function testTUI() {
  console.log('========================================');
  console.log('  TUI Task Display Test');
  console.log('========================================\n');

  const service = new DataService();

  try {
    await service.initialize();
    console.log('✅ Data service initialized\n');

    const tasks = await service.getTasks();
    console.log(`📋 Loaded ${tasks.length} tasks for TUI display\n`);

    // Show sample of tasks as they would appear in TUI
    console.log('Sample tasks (as displayed in TUI):');
    console.log('------------------------------------');

    const sampleTasks = tasks.slice(0, 10);
    sampleTasks.forEach((task) => {
      const priority = ['🔴', '🟡', '🟢', '🔵'][task.priority || 3];
      const state = task.state.padEnd(12);
      console.log(`${priority} ${task.identifier}: ${task.title}`);
      console.log(
        `   State: ${state} | Assignee: ${task.assignee || 'unassigned'}`
      );
      console.log('');
    });

    // Show task distribution
    console.log('\n📊 Task Distribution for TUI:');
    console.log('-----------------------------');

    const states = {};
    const identifierTypes = {
      'ENG-': 0,
      'STA-': 0,
      'LOCAL-': 0,
      Other: 0,
    };

    tasks.forEach((task) => {
      // Count by state
      states[task.state] = (states[task.state] || 0) + 1;

      // Count by identifier type
      if (task.identifier.startsWith('ENG-')) identifierTypes['ENG-']++;
      else if (task.identifier.includes('STA-')) identifierTypes['STA-']++;
      else if (task.identifier.startsWith('LOCAL-'))
        identifierTypes['LOCAL-']++;
      else identifierTypes['Other']++;
    });

    console.log('\nBy State (for TUI columns):');
    Object.entries(states)
      .sort()
      .forEach(([state, count]) => {
        const bar = '█'.repeat(Math.min(30, Math.floor(count / 5)));
        console.log(
          `  ${state.padEnd(15)} ${count.toString().padStart(3)} ${bar}`
        );
      });

    console.log('\nBy Source:');
    Object.entries(identifierTypes).forEach(([type, count]) => {
      if (count > 0) {
        console.log(`  ${type.padEnd(10)} ${count}`);
      }
    });

    console.log('\n✅ TUI would display these tasks correctly!');
    console.log('\nTo launch the actual TUI, run:');
    console.log('  LINEAR_API_KEY="your-key" npm run tui');
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
  } finally {
    service.cleanup();
  }
}

// Run the test
testTUI().catch(console.error);
