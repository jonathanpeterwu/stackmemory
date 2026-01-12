#!/usr/bin/env node

/**
 * Debug why Linear updates are failing
 */

import 'dotenv/config';

const API_KEY = process.env.LINEAR_OAUTH_TOKEN || process.env.LINEAR_API_KEY;
if (!API_KEY) {
  console.error('❌ LINEAR_OAUTH_TOKEN or LINEAR_API_KEY environment variable not set');
  console.log('Please set LINEAR_OAUTH_TOKEN or LINEAR_API_KEY in your .env file or export it in your shell');
  process.exit(1);
}

async function debugLinearUpdate() {
  console.log('🔍 Debugging Linear update issues...\n');
  
  // First, test basic API access
  console.log('1. Testing API authentication:');
  const testQuery = `
    query TestAuth {
      viewer {
        id
        email
      }
    }
  `;
  
  let response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: testQuery })
  });
  
  let result = await response.json();
  console.log('Auth result:', JSON.stringify(result, null, 2));
  
  // Get workflow states
  console.log('\n2. Fetching workflow states:');
  const statesQuery = `
    query GetStates {
      workflowStates {
        nodes {
          id
          name
          type
          team {
            id
            key
          }
        }
      }
    }
  `;
  
  response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: statesQuery })
  });
  
  result = await response.json();
  console.log('States:', JSON.stringify(result.data?.workflowStates?.nodes || [], null, 2));
  
  // Try to get a specific task
  console.log('\n3. Fetching specific task STA-279:');
  const taskQuery = `
    query GetIssue {
      issue(id: "STA-279") {
        id
        identifier
        title
        state {
          id
          name
          type
        }
      }
    }
  `;
  
  response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: taskQuery })
  });
  
  result = await response.json();
  console.log('Task result:', JSON.stringify(result, null, 2));
  
  // If task exists, try to update it
  if (result.data?.issue) {
    const task = result.data.issue;
    console.log('\n4. Attempting to update task:', task.identifier);
    
    // Find Done state for the same team
    const statesResponse = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: statesQuery })
    });
    
    const statesResult = await statesResponse.json();
    const doneState = statesResult.data?.workflowStates?.nodes?.find(s => 
      s.type === 'completed' && s.team?.key === 'STA'
    );
    
    if (!doneState) {
      console.log('❌ Could not find Done state for STA team');
      return;
    }
    
    console.log('Found Done state:', doneState.id, doneState.name);
    
    const updateMutation = `
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
    
    const updateResponse = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        query: updateMutation,
        variables: {
          issueId: task.id,
          stateId: doneState.id
        }
      })
    });
    
    const updateResult = await updateResponse.json();
    console.log('\nUpdate result:', JSON.stringify(updateResult, null, 2));
    
    if (updateResult.errors) {
      console.log('\n❌ Update failed with errors:', updateResult.errors);
    } else if (updateResult.data?.issueUpdate?.success) {
      console.log('\n✅ Update successful!');
    }
  }
}

// Run
debugLinearUpdate().catch(console.error);