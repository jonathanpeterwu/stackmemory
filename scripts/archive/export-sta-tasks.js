#!/usr/bin/env node

/**
 * Export STA- tasks to JSON for manual import
 */

import { LinearRestClient } from '../dist/integrations/linear/rest-client.js';
import fs from 'fs';

async function exportSTATasks() {
  try {
    console.log('🔄 Exporting STA- tasks...');
    
    const client = new LinearRestClient(process.env.LINEAR_API_KEY);
    const allTasks = await client.getAllTasks(true);
    
    // Filter STA- tasks
    const staTasks = allTasks.filter(task => task.identifier.startsWith('STA-'));
    
    // Export data
    const exportData = {
      exported: new Date().toISOString(),
      source: 'LiftCL-Stackmemoryai',
      taskCount: staTasks.length,
      tasks: staTasks.map(task => ({
        identifier: task.identifier,
        title: task.title,
        description: task.description || '',
        state: task.state.name,
        priority: task.priority || 0,
        assignee: task.assignee?.name || null,
        estimate: task.estimate || null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        url: task.url
      }))
    };
    
    // Write to file
    const filename = `sta-tasks-export-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(filename, JSON.stringify(exportData, null, 2));
    
    console.log(`✅ Exported ${staTasks.length} STA- tasks to ${filename}`);
    console.log('📋 Summary by state:');
    
    const stateCounts = {};
    staTasks.forEach(task => {
      const state = task.state.type;
      stateCounts[state] = (stateCounts[state] || 0) + 1;
    });
    
    Object.entries(stateCounts).forEach(([state, count]) => {
      console.log(`  ${state}: ${count}`);
    });
    
  } catch (error) {
    console.error('❌ Export failed:', error.message);
    process.exit(1);
  }
}

exportSTATasks();