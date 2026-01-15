#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function removeSTATasks() {
  const tasksFile = path.join(__dirname, '..', '.stackmemory', 'tasks.jsonl');
  
  if (!fs.existsSync(tasksFile)) {
    console.error('❌ Tasks file not found:', tasksFile);
    return;
  }
  
  // Create backup first
  const backupFile = tasksFile + '.backup-' + Date.now();
  fs.copyFileSync(tasksFile, backupFile);
  console.log(`💾 Backup created: ${backupFile}`);
  
  // Read all tasks
  const lines = fs.readFileSync(tasksFile, 'utf8').split('\n').filter(l => l.trim());
  
  const keptTasks = [];
  const removedTasks = [];
  
  for (const line of lines) {
    try {
      const task = JSON.parse(line);
      
      // Check if task has STA- in title
      const hasSTAId = task.title?.includes('[STA-');
      
      if (hasSTAId) {
        removedTasks.push(task);
      } else {
        keptTasks.push(line);
      }
    } catch (e) {
      // Keep unparseable lines as-is
      keptTasks.push(line);
    }
  }
  
  console.log(`\n📊 Task Analysis:`);
  console.log(`   Total tasks: ${lines.length}`);
  console.log(`   STA tasks to remove: ${removedTasks.length}`);
  console.log(`   Tasks to keep: ${keptTasks.length}`);
  
  if (removedTasks.length > 0) {
    console.log('\n🗑️  Removing STA tasks:');
    for (const task of removedTasks.slice(0, 10)) {
      const match = task.title.match(/\[(STA-\d+)\]/);
      console.log(`   - ${match?.[1] || 'STA-???'}: ${task.title.substring(0, 60)}...`);
    }
    if (removedTasks.length > 10) {
      console.log(`   ... and ${removedTasks.length - 10} more`);
    }
    
    // Write cleaned file
    fs.writeFileSync(tasksFile, keptTasks.join('\n') + '\n');
    console.log(`\n✅ Removed ${removedTasks.length} STA tasks`);
    console.log(`📂 ${keptTasks.length} tasks remaining`);
  } else {
    console.log('\n✅ No STA tasks found to remove');
  }
}

removeSTATasks();