#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function cleanDuplicateTasks() {
  const tasksFile = path.join(__dirname, '..', '.stackmemory', 'tasks.jsonl');
  
  if (!fs.existsSync(tasksFile)) {
    console.error('Tasks file not found:', tasksFile);
    return;
  }
  
  const lines = fs.readFileSync(tasksFile, 'utf8').split('\n').filter(l => l.trim());
  
  const taskMap = new Map();
  const seenTitles = new Map();
  const duplicates = [];
  
  // Process each line
  for (const line of lines) {
    try {
      const task = JSON.parse(line);
      
      // Create a unique key based on title and external refs
      let key = task.title;
      if (task.external_refs) {
        const linearId = Object.keys(task.external_refs).find(k => k.startsWith('STA-') || k.startsWith('ENG-'));
        if (linearId) key = linearId;
      }
      
      // Normalize title for comparison (remove task IDs from title)
      const normalizedTitle = task.title
        .replace(/^\[[^\]]+\]\s*/, '') // Remove [STA-XXX] or [ENG-XXX] prefix
        .replace(/^\[.*?\]\s*/, '') // Remove priority markers
        .trim();
      
      // Track duplicates by normalized title
      if (!seenTitles.has(normalizedTitle)) {
        seenTitles.set(normalizedTitle, task.id);
        taskMap.set(task.id, task);
      } else {
        duplicates.push({
          id: task.id,
          title: task.title,
          keepId: seenTitles.get(normalizedTitle)
        });
      }
    } catch (e) {
      console.warn('Failed to parse line:', e.message);
    }
  }
  
  console.log(`\n📊 Task Analysis:`);
  console.log(`   Total lines: ${lines.length}`);
  console.log(`   Unique tasks: ${taskMap.size}`);
  console.log(`   Duplicates found: ${duplicates.length}`);
  
  if (duplicates.length > 0) {
    console.log('\n🔄 Duplicates to remove:');
    duplicates.forEach(d => {
      console.log(`   - ${d.id}: ${d.title}`);
      console.log(`     (keeping ${d.keepId})`);
    });
    
    // Create backup
    const backupFile = tasksFile + '.backup-' + Date.now();
    fs.copyFileSync(tasksFile, backupFile);
    console.log(`\n💾 Backup created: ${backupFile}`);
    
    // Write cleaned tasks
    const cleanedLines = [];
    for (const line of lines) {
      try {
        const task = JSON.parse(line);
        const isDuplicate = duplicates.find(d => d.id === task.id);
        if (!isDuplicate) {
          cleanedLines.push(line);
        }
      } catch (e) {
        // Keep unparseable lines as-is
        cleanedLines.push(line);
      }
    }
    
    fs.writeFileSync(tasksFile, cleanedLines.join('\n') + '\n');
    console.log(`\n✅ Cleaned tasks file written`);
    console.log(`   Removed ${duplicates.length} duplicate tasks`);
    console.log(`   Final task count: ${cleanedLines.length}`);
  } else {
    console.log('\n✅ No duplicates found!');
  }
  
  // Show remaining unique tasks
  console.log('\n📋 Unique tasks remaining:');
  const uniqueTasks = Array.from(taskMap.values())
    .filter(t => t.type === 'task_create' || t.type === 'task_update')
    .sort((a, b) => (a.priority === 'urgent' ? -1 : a.priority === 'high' ? 0 : 1));
  
  uniqueTasks.slice(0, 10).forEach(task => {
    const status = task.status === 'completed' ? '✅' : 
                   task.status === 'in_progress' ? '🔄' : '⏳';
    console.log(`   ${status} [${task.priority}] ${task.title}`);
  });
  
  if (uniqueTasks.length > 10) {
    console.log(`   ... and ${uniqueTasks.length - 10} more tasks`);
  }
}

cleanDuplicateTasks();