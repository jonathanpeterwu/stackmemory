#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file
dotenv.config({ 
  path: path.join(__dirname, '..', '.env'),
  debug: false,
  override: true,
  silent: true
});

// Debug: Check if key is loaded
console.log(`API Key loaded: ${process.env.LINEAR_API_KEY ? 'Yes' : 'No'} (length: ${process.env.LINEAR_API_KEY?.length || 0})`);

async function queryLinear(query, variables = {}) {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': process.env.LINEAR_API_KEY
    },
    body: JSON.stringify({ query, variables })
  });

  const data = await response.json();
  if (data.errors) {
    throw new Error(data.errors[0].message);
  }
  return data.data;
}

async function syncLinearTasks() {
  const apiKey = process.env.LINEAR_API_KEY;
  
  if (!apiKey) {
    console.error('❌ LINEAR_API_KEY not found in environment');
    process.exit(1);
  }
  
  console.log('🔄 Connecting to Linear API...');
  
  try {
    // Test connection
    const viewer = await queryLinear('{ viewer { id email name } }');
    console.log(`✅ Connected as: ${viewer.viewer.name || viewer.viewer.email}`);
    
    // Get teams
    const teamsData = await queryLinear(`
      query {
        teams {
          nodes {
            id
            key
            name
          }
        }
      }
    `);
    
    console.log(`\n📋 Found ${teamsData.teams.nodes.length} teams:`);
    for (const team of teamsData.teams.nodes) {
      console.log(`  - ${team.key}: ${team.name}`);
    }
    
    // Get issues from all teams
    const issuesData = await queryLinear(`
      query {
        issues(first: 100, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            description
            state {
              name
              type
            }
            priority
            priorityLabel
            team {
              key
              name
            }
            assignee {
              name
              email
            }
            createdAt
            updatedAt
            url
          }
        }
      }
    `);
    
    console.log(`\n📥 Found ${issuesData.issues.nodes.length} issues total`);
    
    // Group by team
    const issuesByTeam = {};
    for (const issue of issuesData.issues.nodes) {
      const teamKey = issue.team.key;
      if (!issuesByTeam[teamKey]) {
        issuesByTeam[teamKey] = [];
      }
      issuesByTeam[teamKey].push(issue);
    }
    
    for (const [teamKey, issues] of Object.entries(issuesByTeam)) {
      console.log(`  ${teamKey}: ${issues.length} issues`);
    }
    
    // Load local tasks
    const tasksFile = path.join(__dirname, '..', '.stackmemory', 'tasks.jsonl');
    const localTasks = [];
    const localLinearIds = new Set();
    
    if (fs.existsSync(tasksFile)) {
      const lines = fs.readFileSync(tasksFile, 'utf8').split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const task = JSON.parse(line);
          if (task.type === 'task_create' || task.type === 'task_update') {
            localTasks.push(task);
            const match = task.title?.match(/\[(STA-\d+|ENG-\d+)\]/);
            if (match) {
              localLinearIds.add(match[1]);
            }
          }
        } catch (e) {
          // Skip invalid lines
        }
      }
    }
    
    console.log(`\n📂 Local tasks: ${localTasks.length}`);
    console.log(`🌐 Linear issues: ${issuesData.issues.nodes.length}`);
    
    // Find issues not in local tasks
    const missingLocally = [];
    for (const issue of issuesData.issues.nodes) {
      if (!localLinearIds.has(issue.identifier)) {
        missingLocally.push(issue);
      }
    }
    
    if (missingLocally.length > 0) {
      console.log(`\n🆕 Issues in Linear but not in local tasks (${missingLocally.length}):`);
      
      const newTasks = [];
      for (const issue of missingLocally.slice(0, 20)) {
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
          tags: ['linear', 'synced', issue.team.key.toLowerCase()],
          context_score: 0.5,
          external_refs: {
            linear_id: issue.id,
            linear_identifier: issue.identifier,
            linear_url: issue.url,
            team: issue.team.key
          }
        };
        
        newTasks.push(JSON.stringify(task));
      }
      
      if (missingLocally.length > 20) {
        console.log(`  ... and ${missingLocally.length - 20} more`);
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
    const linearIds = new Set(issuesData.issues.nodes.map(i => i.identifier));
    const missingInLinear = localTasks.filter(task => {
      const match = task.title?.match(/\[(STA-\d+|ENG-\d+)\]/);
      return match && !linearIds.has(match[1]);
    });
    
    if (missingInLinear.length > 0) {
      console.log(`\n📤 Local tasks not in Linear (${missingInLinear.length}):`);
      for (const task of missingInLinear.slice(0, 10)) {
        const match = task.title?.match(/\[(STA-\d+|ENG-\d+)\]/);
        console.log(`  - ${match?.[1] || 'Unknown'}: ${task.title}`);
      }
      if (missingInLinear.length > 10) {
        console.log(`  ... and ${missingInLinear.length - 10} more`);
      }
      console.log('\n💡 These may be deleted Linear issues or local-only tasks');
    }
    
    // Summary
    console.log('\n📊 Sync Summary:');
    console.log(`  Total Linear issues: ${issuesData.issues.nodes.length}`);
    console.log(`  Total local tasks: ${localTasks.length}`);
    console.log(`  Added to local: ${Math.min(missingLocally.length, 20)}`);
    console.log(`  Local-only tasks: ${missingInLinear.length}`);
    
  } catch (error) {
    console.error('❌ Error syncing with Linear:', error.message);
    if (error.message.includes('authentication') || error.message.includes('401')) {
      console.log('\n🔑 Authentication failed. Please check your LINEAR_API_KEY');
    }
  }
}

function mapLinearState(state) {
  switch (state) {
    case 'completed': return 'completed';
    case 'started': return 'in_progress';
    case 'canceled': return 'cancelled';
    case 'cancelled': return 'cancelled';
    default: return 'pending';
  }
}

function mapLinearPriority(priority) {
  switch (priority) {
    case 0: return 'none';
    case 1: return 'urgent';
    case 2: return 'high';
    case 3: return 'medium';
    case 4: return 'low';
    default: return 'medium';
  }
}

syncLinearTasks();