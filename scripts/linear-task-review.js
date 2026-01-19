#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ 
  path: path.join(__dirname, '..', '.env'),
  silent: true
});

async function queryLinear(query, variables = {}) {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': process.env.STACKMEMORY_LINEAR_API_KEY || process.env.LINEAR_API_KEY
    },
    body: JSON.stringify({ query, variables })
  });

  const data = await response.json();
  if (data.errors) {
    throw new Error(data.errors[0].message);
  }
  return data.data;
}

async function reviewTasks() {
  console.log('📋 LINEAR TASK REVIEW\n' + '='.repeat(50));
  
  try {
    // Get viewer info
    const viewerData = await queryLinear(`
      query {
        viewer {
          name
          email
        }
      }
    `);
    
    console.log(`👤 Logged in as: ${viewerData.viewer.name || viewerData.viewer.email}\n`);
    
    // Get all active issues
    const issuesData = await queryLinear(`
      query {
        issues(
          filter: {
            state: { type: { in: ["started", "unstarted"] } }
          }
          orderBy: updatedAt
          first: 100
        ) {
          nodes {
            identifier
            title
            priority
            priorityLabel
            createdAt
            updatedAt
            state {
              name
              type
            }
            assignee {
              name
              email
            }
            labels {
              nodes {
                name
                color
              }
            }
            estimate
            url
          }
        }
      }
    `);
    
    const issues = issuesData.issues.nodes;
    
    // Group by state
    const byState = {};
    issues.forEach(issue => {
      const stateName = issue.state.name;
      if (!byState[stateName]) byState[stateName] = [];
      byState[stateName].push(issue);
    });
    
    // Priority mapping
    const priorityLabels = {
      0: '🔴 No Priority',
      1: '🔴 Urgent',
      2: '🟠 High',
      3: '🟡 Medium',
      4: '🔵 Low'
    };
    
    // Display by state
    const stateOrder = ['In Progress', 'Todo', 'Triage', 'Backlog'];
    
    stateOrder.forEach(state => {
      if (byState[state] && byState[state].length > 0) {
        console.log(`\n📊 ${state.toUpperCase()} (${byState[state].length} tasks)`);
        console.log('-'.repeat(50));
        
        byState[state]
          .sort((a, b) => (a.priority || 5) - (b.priority || 5))
          .slice(0, 10)
          .forEach(issue => {
            const priority = priorityLabels[issue.priority] || '⚪ None';
            const assignee = issue.assignee ? `👤 ${issue.assignee.name}` : '👤 Unassigned';
            const labels = issue.labels.nodes.map(l => l.name).join(', ');
            const labelStr = labels ? ` [${labels}]` : '';
            
            console.log(`\n  ${issue.identifier}: ${issue.title}`);
            console.log(`    ${priority} | ${assignee}${labelStr}`);
            console.log(`    📎 ${issue.url}`);
          });
          
        if (byState[state].length > 10) {
          console.log(`\n  ... and ${byState[state].length - 10} more tasks`);
        }
      }
    });
    
    // Summary statistics
    console.log('\n' + '='.repeat(50));
    console.log('📈 SUMMARY STATISTICS\n');
    
    const inProgress = byState['In Progress']?.length || 0;
    const todo = byState['Todo']?.length || 0;
    const triage = byState['Triage']?.length || 0;
    const backlog = byState['Backlog']?.length || 0;
    
    console.log(`  🏃 In Progress: ${inProgress}`);
    console.log(`  📝 Todo: ${todo}`);
    console.log(`  🔍 Triage: ${triage}`);
    console.log(`  📦 Backlog: ${backlog}`);
    console.log(`  📊 Total Active: ${issues.length}`);
    
    // High priority items
    const urgent = issues.filter(i => i.priority === 1);
    const high = issues.filter(i => i.priority === 2);
    
    if (urgent.length > 0) {
      console.log('\n🚨 URGENT PRIORITY TASKS:');
      urgent.forEach(issue => {
        const state = issue.state.name;
        const assignee = issue.assignee?.name || 'Unassigned';
        console.log(`  • ${issue.identifier}: ${issue.title} [${state}] - ${assignee}`);
      });
    }
    
    if (high.length > 0) {
      console.log('\n🔥 HIGH PRIORITY TASKS:');
      high.slice(0, 5).forEach(issue => {
        const state = issue.state.name;
        const assignee = issue.assignee?.name || 'Unassigned';
        console.log(`  • ${issue.identifier}: ${issue.title} [${state}] - ${assignee}`);
      });
    }
    
    // Recommendations
    console.log('\n' + '='.repeat(50));
    console.log('💡 RECOMMENDED NEXT ACTIONS:\n');
    
    // Find tasks to work on
    const recommendations = [];
    
    // 1. In-progress tasks that need completion
    const myInProgress = issues.filter(i => 
      i.state.name === 'In Progress' && 
      (!i.assignee || i.assignee.name === viewerData.viewer.name)
    );
    
    if (myInProgress.length > 0) {
      recommendations.push({
        reason: '🏃 Continue in-progress work',
        tasks: myInProgress.slice(0, 2)
      });
    }
    
    // 2. High priority unassigned todos
    const highPriorityTodos = issues.filter(i => 
      i.state.name === 'Todo' && 
      i.priority <= 2 &&
      !i.assignee
    );
    
    if (highPriorityTodos.length > 0) {
      recommendations.push({
        reason: '🔥 High priority unassigned tasks',
        tasks: highPriorityTodos.slice(0, 2)
      });
    }
    
    // 3. Any todo tasks
    const todoTasks = issues.filter(i => 
      i.state.name === 'Todo' &&
      !i.assignee
    );
    
    if (todoTasks.length > 0 && recommendations.length < 2) {
      recommendations.push({
        reason: '📝 Available todo tasks',
        tasks: todoTasks.slice(0, 2)
      });
    }
    
    if (recommendations.length > 0) {
      recommendations.forEach(rec => {
        console.log(rec.reason);
        rec.tasks.forEach(task => {
          const priority = priorityLabels[task.priority] || '⚪ None';
          console.log(`  └─ ${task.identifier}: ${task.title}`);
          console.log(`     ${priority} | ${task.url}`);
        });
        console.log('');
      });
    } else {
      console.log('✅ No immediate tasks requiring attention');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

reviewTasks();