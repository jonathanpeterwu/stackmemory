#!/usr/bin/env node

import { LinearClient } from '@linear/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function syncLinearTasks() {
  const apiKey = process.env.LINEAR_API_KEY;
  
  if (!apiKey) {
    console.error('❌ LINEAR_API_KEY not found in environment');
    process.exit(1);
  }
  
  console.log('🔄 Connecting to Linear with API key...');
  // Linear SDK expects the API key without the "lin_api_" prefix in some versions
  // But let's use the full key and pass it correctly
  const linearClient = new LinearClient({ 
    apiKey: apiKey,
    headers: {
      'Authorization': apiKey
    }
  });
  
  try {
    // Test connection and get team info
    console.log('📊 Fetching workspace info...');
    const me = await linearClient.viewer;
    console.log(`✅ Connected as: ${me.name || me.email}`);
    
    // Get all teams
    const teams = await linearClient.teams();
    console.log(`\n📋 Found ${teams.nodes.length} teams:`);
    
    for (const team of teams.nodes) {
      console.log(`  - ${team.key}: ${team.name}`);
    }
    
    // Get issues from StackMemory team
    const stackTeam = teams.nodes.find(t => t.key === 'STA' || t.key === 'STACK');
    if (!stackTeam) {
      console.log('\n⚠️ No StackMemory team found (looking for STA or STACK)');
      return;
    }
    
    console.log(`\n📥 Fetching issues from ${stackTeam.name} (${stackTeam.key})...`);
    const issues = await linearClient.issues({
      filter: {
        team: { key: { eq: stackTeam.key } }
      },
      first: 100
    });
    
    console.log(`Found ${issues.nodes.length} issues\n`);
    
    // Load local tasks
    const tasksFile = path.join(__dirname, '..', '.stackmemory', 'tasks.jsonl');
    const localTasks = [];
    
    if (fs.existsSync(tasksFile)) {
      const lines = fs.readFileSync(tasksFile, 'utf8').split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const task = JSON.parse(line);
          if (task.type === 'task_create' || task.type === 'task_update') {
            localTasks.push(task);
          }
        } catch (e) {
          // Skip invalid lines
        }
      }
    }
    
    console.log(`📂 Local tasks: ${localTasks.length}`);
    console.log(`🌐 Linear issues: ${issues.nodes.length}`);
    
    // Find tasks that exist in Linear but not locally
    const localLinearIds = new Set();
    for (const task of localTasks) {
      const match = task.title?.match(/\[(STA-\d+|ENG-\d+)\]/);
      if (match) {
        localLinearIds.add(match[1]);
      }
    }
    
    const missingLocally = [];
    for (const issue of issues.nodes) {
      if (!localLinearIds.has(issue.identifier)) {
        missingLocally.push(issue);
      }
    }
    
    if (missingLocally.length > 0) {
      console.log(`\n🆕 Issues in Linear but not in local tasks (${missingLocally.length}):`);
      
      // Create task entries for missing issues
      const newTasks = [];
      for (const issue of missingLocally) {
        console.log(`  - ${issue.identifier}: ${issue.title}`);
        
        const taskId = `tsk-${Math.random().toString(36).substr(2, 8)}`;
        const task = {
          id: taskId,
          type: 'task_create',
          timestamp: Date.now(),
          frame_id: 'linear-sync',
          title: `[${issue.identifier}] ${issue.title}`,
          description: issue.description || '',
          status: mapLinearState(issue.state.type),
          priority: mapLinearPriority(issue.priority),
          created_at: Date.now(),
          depends_on: [],
          blocks: [],
          tags: ['linear', 'synced'],
          context_score: 0.5,
          external_refs: {
            linear_id: issue.id,
            linear_url: issue.url
          }
        };
        
        newTasks.push(JSON.stringify(task));
      }
      
      if (newTasks.length > 0) {
        console.log(`\n💾 Adding ${newTasks.length} tasks to local storage...`);
        fs.appendFileSync(tasksFile, '\n' + newTasks.join('\n') + '\n');
        console.log('✅ Tasks synced successfully!');
      }
    } else {
      console.log('\n✅ All Linear issues already exist locally');
    }
    
    // Find local tasks not in Linear
    const linearIds = new Set(issues.nodes.map(i => i.identifier));
    const missingInLinear = localTasks.filter(task => {
      const match = task.title?.match(/\[(STA-\d+|ENG-\d+)\]/);
      return match && !linearIds.has(match[1]);
    });
    
    if (missingInLinear.length > 0) {
      console.log(`\n📤 Local tasks not in Linear (${missingInLinear.length}):`);
      for (const task of missingInLinear.slice(0, 10)) {
        console.log(`  - ${task.title}`);
      }
      if (missingInLinear.length > 10) {
        console.log(`  ... and ${missingInLinear.length - 10} more`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error syncing with Linear:', error.message);
    if (error.message.includes('authentication') || error.message.includes('401')) {
      console.log('\n🔑 Authentication failed. Please check your LINEAR_API_KEY');
      console.log('You can get an API key from: https://linear.app/settings/api');
    }
  }
}

function mapLinearState(state) {
  switch (state) {
    case 'completed': return 'completed';
    case 'started': return 'in_progress';
    case 'cancelled': return 'cancelled';
    default: return 'pending';
  }
}

function mapLinearPriority(priority) {
  switch (priority) {
    case 1: return 'urgent';
    case 2: return 'high';
    case 3: return 'medium';
    case 4: return 'low';
    default: return 'medium';
  }
}

syncLinearTasks();