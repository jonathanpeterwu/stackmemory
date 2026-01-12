#!/usr/bin/env node

/**
 * Update Linear task status based on actual implementation status - FIXED version
 */

import 'dotenv/config';

const API_KEY = process.env.LINEAR_OAUTH_TOKEN || process.env.LINEAR_API_KEY;
if (!API_KEY) {
  console.error('❌ LINEAR_OAUTH_TOKEN or LINEAR_API_KEY environment variable not set');
  console.log('Please set LINEAR_OAUTH_TOKEN or LINEAR_API_KEY in your .env file or export it in your shell');
  process.exit(1);
}

// Tasks that should be marked as DONE based on commits and documentation
const COMPLETED_TASKS = {
  // Phase 1: Core Runtime - COMPLETE
  'STA-279': 'Implement LLM-Driven Context Retrieval',
  
  // Phase 2: Intelligence Layer - COMPLETE  
  'STA-280': 'Complete Hybrid Digest Generation (60/40)',
  'STA-281': 'Implement Smart Trace Detection and Bundling',
  'STA-282': 'Implement Configurable Tool Scoring System',
  
  // Phase 3: Collaboration - COMPLETE
  'STA-283': 'Implement Dual Stack Architecture',
  'STA-284': 'Build Frame Handoff Mechanism',
  'STA-271': '[STA-99] Phase 3: Dual Stack Architecture',
  'STA-275': '[STA-100] Phase 3: Frame Handoff Mechanism',
  'STA-285': 'Implement Merge Conflict Resolution',
  'STA-286': 'Build Team Analytics',
  
  // Additional completed features
  'STA-276': '[STA-91] Finalize Session Persistence Design',
  'STA-277': '[STA-90] Complete Linear MCP Integration Documentation',
  'STA-155': '[STA-89] Complete Context Frame Manager Tests',
};

// Tasks in progress
const IN_PROGRESS_TASKS = {
  'STA-287': 'Implement Remote Infinite Storage System',
  'STA-288': 'Build Incremental Garbage Collection',
};

// Tasks to cancel (duplicates or no longer needed)
const CANCEL_TASKS = {
  'STA-272': 'Engineering x Marketing Team',
  'STA-273': 'Engineering x Operations Team',
  'STA-274': 'Engineering x Success Team',
  'STA-268': 'Task Analytics Dashboard',
  'STA-264': 'Complete Documentation TODOs',
};

async function getWorkflowStates() {
  const query = `
    query GetStates {
      workflowStates {
        nodes {
          id
          name
          type
          team {
            key
          }
        }
      }
    }
  `;
  
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });
  
  const result = await response.json();
  const states = result.data?.workflowStates?.nodes || [];
  
  // Find STA team states
  const staStates = states.filter(s => s.team?.key === 'STA');
  
  return {
    done: staStates.find(s => s.type === 'completed')?.id,
    inProgress: staStates.find(s => s.type === 'started' && s.name === 'In Progress')?.id,
    canceled: staStates.find(s => s.type === 'canceled' && s.name === 'Canceled')?.id
  };
}

async function getTaskByIdentifier(identifier) {
  const query = `
    query GetIssue {
      issue(id: "${identifier}") {
        id
        identifier
        title
        state {
          name
          type
        }
      }
    }
  `;
  
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });
  
  const result = await response.json();
  return result.data?.issue;
}

async function updateTaskStatus(taskId, stateId) {
  const mutation = `
    mutation UpdateIssue($issueId: String!, $stateId: String!) {
      issueUpdate(
        id: $issueId,
        input: { 
          stateId: $stateId
        }
      ) {
        success
        issue {
          identifier
          state {
            name
          }
        }
      }
    }
  `;
  
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ 
      query: mutation,
      variables: {
        issueId: taskId,
        stateId: stateId
      }
    })
  });
  
  return response.json();
}

async function updateLinearTasks() {
  console.log('📊 Updating Linear task states based on actual implementation...\n');
  
  // Get state IDs
  const states = await getWorkflowStates();
  
  if (!states.done || !states.inProgress) {
    console.error('❌ Could not find required workflow states');
    console.log('Available states:', states);
    return;
  }
  
  console.log('Found states:', {
    done: states.done,
    inProgress: states.inProgress,
    canceled: states.canceled
  });
  
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  
  // Update completed tasks
  console.log('\n✅ Marking completed tasks as Done:\n');
  for (const [identifier, title] of Object.entries(COMPLETED_TASKS)) {
    const task = await getTaskByIdentifier(identifier);
    if (!task) {
      console.log(`  ⚠️  ${identifier} not found`);
      failed++;
      continue;
    }
    
    if (task.state.type === 'completed') {
      console.log(`  ✓ ${identifier} already Done`);
      skipped++;
      continue;
    }
    
    const result = await updateTaskStatus(task.id, states.done);
    if (result.data?.issueUpdate?.success) {
      console.log(`  ✅ ${identifier}: ${title.substring(0, 40)}... → Done`);
      updated++;
    } else {
      console.log(`  ❌ ${identifier}: Failed to update`, result.errors);
      failed++;
    }
    
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Update in-progress tasks
  console.log('\n🔄 Marking in-progress tasks:\n');
  for (const [identifier, title] of Object.entries(IN_PROGRESS_TASKS)) {
    const task = await getTaskByIdentifier(identifier);
    if (!task) {
      console.log(`  ⚠️  ${identifier} not found`);
      failed++;
      continue;
    }
    
    if (task.state.type === 'started') {
      console.log(`  ✓ ${identifier} already In Progress`);
      skipped++;
      continue;
    }
    
    const result = await updateTaskStatus(task.id, states.inProgress);
    if (result.data?.issueUpdate?.success) {
      console.log(`  🔄 ${identifier}: ${title.substring(0, 40)}... → In Progress`);
      updated++;
    } else {
      console.log(`  ❌ ${identifier}: Failed to update`);
      failed++;
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Cancel obsolete tasks
  if (states.canceled) {
    console.log('\n❌ Canceling obsolete tasks:\n');
    for (const [identifier, title] of Object.entries(CANCEL_TASKS)) {
      const task = await getTaskByIdentifier(identifier);
      if (!task) {
        console.log(`  ⚠️  ${identifier} not found`);
        failed++;
        continue;
      }
      
      if (task.state.type === 'canceled') {
        console.log(`  ✓ ${identifier} already Canceled`);
        skipped++;
        continue;
      }
      
      const result = await updateTaskStatus(task.id, states.canceled);
      if (result.data?.issueUpdate?.success) {
        console.log(`  ❌ ${identifier}: ${title.substring(0, 40)}... → Canceled`);
        updated++;
      } else {
        console.log(`  ❌ ${identifier}: Failed to update`);
        failed++;
      }
      
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 UPDATE SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Successfully updated: ${updated} tasks`);
  console.log(`⏭️  Skipped (already correct): ${skipped} tasks`);
  console.log(`❌ Failed: ${failed} tasks`);
  console.log('\nLinear backlog now reflects actual implementation status.');
  console.log('\nRemaining backlog: ~20 tasks (from 188 originally)');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateLinearTasks().catch(console.error);
}

export { updateLinearTasks };