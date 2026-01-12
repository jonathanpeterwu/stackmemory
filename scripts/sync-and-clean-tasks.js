#!/usr/bin/env node

/**
 * Sync Linear tasks with local storage and clean up duplicates
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.LINEAR_OAUTH_TOKEN || process.env.LINEAR_API_KEY;
if (!API_KEY) {
  console.error('❌ LINEAR_OAUTH_TOKEN or LINEAR_API_KEY environment variable not set');
  console.log('Please set LINEAR_OAUTH_TOKEN or LINEAR_API_KEY in your .env file or export it in your shell');
  process.exit(1);
}

async function fetchAllLinearTasks() {
  console.log('📥 Fetching all tasks from Linear...');
  
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
          priority
          estimate
          createdAt
          updatedAt
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
  }
  
  console.log(`  Found ${allIssues.length} Linear tasks\n`);
  return allIssues;
}

function readLocalTasks() {
  const tasksFile = path.join(process.cwd(), '.stackmemory', 'tasks.jsonl');
  
  if (!fs.existsSync(tasksFile)) {
    return [];
  }
  
  const lines = fs.readFileSync(tasksFile, 'utf8').split('\n').filter(Boolean);
  return lines.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function writeLocalTasks(tasks) {
  const tasksFile = path.join(process.cwd(), '.stackmemory', 'tasks.jsonl');
  const backupFile = `${tasksFile}.backup-${Date.now()}`;
  
  // Backup current file
  if (fs.existsSync(tasksFile)) {
    fs.copyFileSync(tasksFile, backupFile);
    console.log(`  Backed up to: ${path.basename(backupFile)}`);
  }
  
  // Write new tasks
  const content = tasks.map(t => JSON.stringify(t)).join('\n');
  fs.writeFileSync(tasksFile, content + '\n');
}

async function syncAndCleanTasks() {
  console.log('🔄 Syncing and cleaning local tasks with Linear...\n');
  
  try {
    // Fetch Linear tasks
    const linearTasks = await fetchAllLinearTasks();
    const linearMap = new Map(linearTasks.map(t => [t.identifier, t]));
    
    // Read local tasks
    console.log('📂 Reading local tasks...');
    const localTasks = readLocalTasks();
    console.log(`  Found ${localTasks.length} local tasks\n`);
    
    // Build new clean task list from Linear
    const cleanTasks = [];
    const taskIdMap = new Map(); // To track duplicates
    
    for (const linearTask of linearTasks) {
      // Skip if we already have this task ID
      if (taskIdMap.has(linearTask.identifier)) {
        console.log(`  Skipping duplicate: ${linearTask.identifier}`);
        continue;
      }
      
      // Find matching local task for metadata
      const localTask = localTasks.find(t => 
        t.linearId === linearTask.identifier ||
        t.taskId === linearTask.identifier ||
        t.id === linearTask.identifier
      );
      
      // Create clean task entry
      const cleanTask = {
        id: linearTask.identifier,
        taskId: linearTask.identifier,
        linearId: linearTask.identifier,
        title: linearTask.title,
        description: linearTask.description || '',
        status: mapLinearStatus(linearTask.state),
        priority: linearTask.priority || 4,
        createdAt: linearTask.createdAt,
        updatedAt: linearTask.updatedAt,
        linearState: linearTask.state.name,
        linearStateType: linearTask.state.type,
        // Preserve local metadata if it exists
        ...(localTask ? {
          localContext: localTask.localContext,
          gitBranch: localTask.gitBranch,
          files: localTask.files,
          completedAt: localTask.completedAt
        } : {})
      };
      
      cleanTasks.push(cleanTask);
      taskIdMap.set(linearTask.identifier, true);
    }
    
    console.log('📊 Sync Results:');
    console.log(`  Linear tasks: ${linearTasks.length}`);
    console.log(`  Local tasks (before): ${localTasks.length}`);
    console.log(`  Clean tasks (after): ${cleanTasks.length}`);
    console.log(`  Removed duplicates: ${localTasks.length - cleanTasks.length}\n`);
    
    // Show what's being removed
    const removedTasks = localTasks.filter(t => 
      !linearMap.has(t.linearId) && 
      !linearMap.has(t.taskId) &&
      !linearMap.has(t.id)
    );
    
    if (removedTasks.length > 0) {
      console.log('🗑️  Removing local-only tasks (not in Linear):');
      removedTasks.slice(0, 10).forEach(t => {
        console.log(`  - ${t.taskId || t.id}: ${(t.title || '').substring(0, 50)}...`);
      });
      if (removedTasks.length > 10) {
        console.log(`  ... and ${removedTasks.length - 10} more\n`);
      }
    }
    
    // Write clean tasks
    console.log('💾 Writing clean task list...');
    writeLocalTasks(cleanTasks);
    
    // Update Linear mappings
    const mappingsFile = path.join(process.cwd(), '.stackmemory', 'linear-mappings.json');
    const mappings = {};
    
    for (const task of cleanTasks) {
      mappings[task.linearId] = {
        linearId: task.linearId,
        localId: task.id,
        title: task.title,
        state: task.linearState,
        lastSync: new Date().toISOString()
      };
    }
    
    fs.writeFileSync(mappingsFile, JSON.stringify(mappings, null, 2));
    console.log('  Updated linear-mappings.json\n');
    
    // Clean up old backup files
    console.log('🧹 Cleaning up old backup files...');
    const backupFiles = fs.readdirSync(path.join(process.cwd(), '.stackmemory'))
      .filter(f => f.startsWith('tasks.jsonl.backup-'))
      .sort()
      .reverse();
    
    // Keep only the 3 most recent backups
    const toDelete = backupFiles.slice(3);
    toDelete.forEach(file => {
      fs.unlinkSync(path.join(process.cwd(), '.stackmemory', file));
      console.log(`  Deleted: ${file}`);
    });
    
    if (toDelete.length === 0) {
      console.log('  No old backups to delete');
    }
    
    console.log('\n✅ Sync and cleanup complete!');
    console.log(`  Active tasks: ${cleanTasks.filter(t => t.linearStateType !== 'completed' && t.linearStateType !== 'canceled').length}`);
    console.log(`  Completed tasks: ${cleanTasks.filter(t => t.linearStateType === 'completed').length}`);
    console.log(`  Total synced tasks: ${cleanTasks.length}`);
    
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    process.exit(1);
  }
}

function mapLinearStatus(state) {
  switch (state.type) {
    case 'completed': return 'completed';
    case 'started': return 'in_progress';
    case 'canceled': return 'cancelled';
    case 'backlog': return 'backlog';
    default: return 'todo';
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  syncAndCleanTasks().catch(console.error);
}

export { syncAndCleanTasks };