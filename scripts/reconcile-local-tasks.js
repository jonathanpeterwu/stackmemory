#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function reconcileLocalTasks() {
  const tasksFile = path.join(__dirname, '..', '.stackmemory', 'tasks.jsonl');
  
  if (!fs.existsSync(tasksFile)) {
    console.error('❌ Tasks file not found:', tasksFile);
    return;
  }
  
  // Read all tasks
  const lines = fs.readFileSync(tasksFile, 'utf8').split('\n').filter(l => l.trim());
  const tasks = new Map();
  const tasksByLinearId = new Map();
  const tasksByTitle = new Map();
  
  console.log('📊 Analyzing local tasks...\n');
  
  // Parse and organize tasks
  for (const line of lines) {
    try {
      const task = JSON.parse(line);
      
      // Store latest version of each task
      if (!tasks.has(task.id) || task.timestamp > tasks.get(task.id).timestamp) {
        tasks.set(task.id, task);
      }
      
      // Extract Linear ID if present
      const linearMatch = task.title?.match(/\[(STA-\d+|ENG-\d+)\]/);
      if (linearMatch) {
        const linearId = linearMatch[1];
        if (!tasksByLinearId.has(linearId)) {
          tasksByLinearId.set(linearId, []);
        }
        tasksByLinearId.get(linearId).push(task);
      }
      
      // Normalize title for duplicate detection
      const normalizedTitle = task.title
        ?.replace(/^\[[^\]]+\]\s*/, '') // Remove [STA-XXX] or [ENG-XXX]
        ?.replace(/^\[.*?\]\s*/, '') // Remove priority markers
        ?.trim();
      
      if (normalizedTitle) {
        if (!tasksByTitle.has(normalizedTitle)) {
          tasksByTitle.set(normalizedTitle, []);
        }
        tasksByTitle.get(normalizedTitle).push(task);
      }
    } catch (e) {
      // Skip invalid lines
    }
  }
  
  console.log(`📋 Total unique tasks: ${tasks.size}`);
  console.log(`🔗 Tasks with Linear IDs: ${tasksByLinearId.size}`);
  
  // Find duplicates by Linear ID
  const duplicateLinearIds = [];
  for (const [linearId, taskList] of tasksByLinearId.entries()) {
    if (taskList.length > 1) {
      duplicateLinearIds.push({ linearId, count: taskList.length, tasks: taskList });
    }
  }
  
  if (duplicateLinearIds.length > 0) {
    console.log(`\n⚠️ Duplicate Linear IDs found (${duplicateLinearIds.length}):`);
    for (const dup of duplicateLinearIds.slice(0, 5)) {
      console.log(`  - ${dup.linearId}: ${dup.count} duplicates`);
      for (const task of dup.tasks) {
        console.log(`    • ${task.id}: ${task.status} (${new Date(task.timestamp).toISOString()})`);
      }
    }
  }
  
  // Find duplicate titles
  const duplicateTitles = [];
  for (const [title, taskList] of tasksByTitle.entries()) {
    if (taskList.length > 1) {
      // Check if they have different Linear IDs
      const linearIds = new Set();
      for (const task of taskList) {
        const match = task.title?.match(/\[(STA-\d+|ENG-\d+)\]/);
        if (match) linearIds.add(match[1]);
      }
      
      if (linearIds.size > 1 || linearIds.size === 0) {
        duplicateTitles.push({ title, count: taskList.length, tasks: taskList });
      }
    }
  }
  
  if (duplicateTitles.length > 0) {
    console.log(`\n⚠️ Duplicate titles found (${duplicateTitles.length}):`);
    for (const dup of duplicateTitles.slice(0, 5)) {
      console.log(`  - "${dup.title}": ${dup.count} duplicates`);
    }
  }
  
  // Show task status breakdown
  const statusCounts = {};
  for (const task of tasks.values()) {
    const status = task.status || 'unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  
  console.log('\n📊 Task Status Breakdown:');
  for (const [status, count] of Object.entries(statusCounts)) {
    const emoji = status === 'completed' ? '✅' :
                  status === 'in_progress' ? '🔄' :
                  status === 'cancelled' ? '❌' : '⏳';
    console.log(`  ${emoji} ${status}: ${count}`);
  }
  
  // Priority breakdown
  const priorityCounts = {};
  for (const task of tasks.values()) {
    const priority = task.priority || 'none';
    priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
  }
  
  console.log('\n🎯 Priority Breakdown:');
  for (const [priority, count] of Object.entries(priorityCounts)) {
    console.log(`  - ${priority}: ${count}`);
  }
  
  // Recent active tasks
  const recentTasks = Array.from(tasks.values())
    .filter(t => t.status === 'in_progress' || (t.timestamp > Date.now() - 7 * 24 * 60 * 60 * 1000))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10);
  
  console.log('\n🕒 Recent Active Tasks:');
  for (const task of recentTasks) {
    const status = task.status === 'completed' ? '✅' :
                   task.status === 'in_progress' ? '🔄' : '⏳';
    const linearId = task.title?.match(/\[(STA-\d+|ENG-\d+)\]/)?.[1] || '';
    console.log(`  ${status} ${linearId ? `[${linearId}]` : ''} ${task.title}`);
  }
  
  // Recommendations
  console.log('\n💡 Recommendations:');
  if (duplicateLinearIds.length > 0) {
    console.log(`  - ${duplicateLinearIds.length} tasks have duplicate Linear IDs - consider deduplication`);
  }
  if (duplicateTitles.length > 0) {
    console.log(`  - ${duplicateTitles.length} task titles are duplicated - review for consolidation`);
  }
  
  const pendingCount = statusCounts.pending || 0;
  const inProgressCount = statusCounts.in_progress || 0;
  
  if (pendingCount > 20) {
    console.log(`  - ${pendingCount} pending tasks - consider prioritizing or archiving old tasks`);
  }
  if (inProgressCount > 5) {
    console.log(`  - ${inProgressCount} tasks in progress - consider focusing on completion`);
  }
  
  console.log('\n✅ Task reconciliation complete!');
}

reconcileLocalTasks();