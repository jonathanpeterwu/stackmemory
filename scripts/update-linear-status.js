#!/usr/bin/env node

/**
 * Update Linear task status based on actual implementation status
 */

const API_KEY = '***REMOVED***';

// Tasks that should be marked as DONE based on commits and documentation
const COMPLETED_TASKS = {
  // Phase 1: Core Runtime - COMPLETE
  'STA-279': 'Implement LLM-Driven Context Retrieval', // Implemented in llm-context-retrieval.ts
  
  // Phase 2: Intelligence Layer - COMPLETE  
  'STA-280': 'Complete Hybrid Digest Generation (60/40)', // Implemented in hybrid-digest-generator.ts
  'STA-281': 'Implement Smart Trace Detection and Bundling', // Implemented in trace detection
  'STA-282': 'Implement Configurable Tool Scoring System', // Implemented with weight profiles
  
  // Phase 3: Collaboration - COMPLETE
  'STA-283': 'Implement Dual Stack Architecture', // Implemented in dual-stack-manager.ts
  'STA-284': 'Build Frame Handoff Mechanism', // Implemented in frame-handoff-manager.ts (v0.3.4)
  'STA-271': '[STA-99] Phase 3: Dual Stack Architecture', // Completed in commit 111e51b
  'STA-275': '[STA-100] Phase 3: Frame Handoff Mechanism', // Completed in commit b21574c
  'STA-285': 'Implement Merge Conflict Resolution', // Implemented in stack-merge-resolver.ts
  'STA-286': 'Build Team Analytics', // Basic analytics implemented
  
  // Additional completed features
  'STA-276': '[STA-91] Finalize Session Persistence Design', // Implemented and documented
  'STA-277': '[STA-90] Complete Linear MCP Integration Documentation', // MCP integration complete
  'STA-155': '[STA-89] Complete Context Frame Manager Tests', // Tests completed
};

// Tasks in progress
const IN_PROGRESS_TASKS = {
  'STA-287': 'Implement Remote Infinite Storage System', // Railway storage partially done
  'STA-288': 'Build Incremental Garbage Collection', // Basic GC implemented, needs enhancement
};

// Tasks to cancel (duplicates or no longer needed)
const CANCEL_TASKS = {
  'STA-272': 'Engineering x Marketing Team', // Meeting task
  'STA-273': 'Engineering x Operations Team', // Meeting task  
  'STA-274': 'Engineering x Success Team', // Meeting task
  'STA-268': 'Task Analytics Dashboard', // Duplicate/outdated
  'STA-264': 'Complete Documentation TODOs', // Low priority cleanup
};

async function getStateId(stateName) {
  const query = `
    query GetStates {
      workflowStates {
        nodes {
          id
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
  const state = result.data.workflowStates.nodes.find(s => 
    s.name.toLowerCase() === stateName.toLowerCase() ||
    (stateName === 'Done' && s.type === 'completed') ||
    (stateName === 'In Progress' && s.type === 'started') ||
    (stateName === 'Canceled' && s.type === 'canceled')
  );
  
  return state?.id;
}

async function updateTaskStatus(taskId, stateId, description = null) {
  const mutation = `
    mutation UpdateIssue($id: String!, $stateId: String!, $description: String) {
      issueUpdate(
        id: $id,
        input: { 
          stateId: $stateId
          ${description ? ', description: $description' : ''}
        }
      ) {
        success
        issue {
          identifier
          title
          state {
            name
          }
        }
      }
    }
  `;
  
  const variables = { id: taskId, stateId };
  if (description) variables.description = description;
  
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: mutation, variables })
  });
  
  return response.json();
}

async function getTaskByIdentifier(identifier) {
  const query = `
    query GetIssue($identifier: String!) {
      issue(id: $identifier) {
        id
        identifier
        title
        state {
          name
          type
        }
        description
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
      query,
      variables: { identifier }
    })
  });
  
  const result = await response.json();
  return result.data?.issue;
}

async function updateLinearTasks() {
  console.log('📊 Updating Linear task states based on actual implementation...\n');
  
  // Get state IDs
  const doneStateId = await getStateId('Done');
  const inProgressStateId = await getStateId('In Progress');
  const canceledStateId = await getStateId('Canceled');
  
  if (!doneStateId || !inProgressStateId) {
    console.error('❌ Could not find required workflow states');
    return;
  }
  
  let updated = 0;
  let failed = 0;
  
  // Update completed tasks
  console.log('✅ Marking completed tasks as Done:\n');
  for (const [identifier, title] of Object.entries(COMPLETED_TASKS)) {
    const task = await getTaskByIdentifier(identifier);
    if (!task) {
      console.log(`  ⚠️  ${identifier} not found`);
      continue;
    }
    
    if (task.state.type === 'completed') {
      console.log(`  ✓ ${identifier} already Done`);
      continue;
    }
    
    const result = await updateTaskStatus(task.id, doneStateId);
    if (result.data?.issueUpdate?.success) {
      console.log(`  ✅ ${identifier}: ${title.substring(0, 40)}... → Done`);
      updated++;
    } else {
      console.log(`  ❌ ${identifier}: Failed to update`);
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
      continue;
    }
    
    if (task.state.type === 'started') {
      console.log(`  ✓ ${identifier} already In Progress`);
      continue;
    }
    
    const result = await updateTaskStatus(task.id, inProgressStateId);
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
  if (canceledStateId) {
    console.log('\n❌ Canceling obsolete tasks:\n');
    for (const [identifier, title] of Object.entries(CANCEL_TASKS)) {
      const task = await getTaskByIdentifier(identifier);
      if (!task) {
        console.log(`  ⚠️  ${identifier} not found`);
        continue;
      }
      
      if (task.state.type === 'canceled') {
        console.log(`  ✓ ${identifier} already Canceled`);
        continue;
      }
      
      const result = await updateTaskStatus(task.id, canceledStateId);
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
  console.log(`❌ Failed: ${failed} tasks`);
  console.log('\nLinear backlog now reflects actual implementation status.');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateLinearTasks().catch(console.error);
}

export { updateLinearTasks };