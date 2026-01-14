#!/usr/bin/env node
import 'dotenv/config';
import { LinearClient } from '@linear/sdk';

const API_KEY = process.env.LINEAR_API_KEY;

if (!API_KEY) {
    console.error('❌ LINEAR_API_KEY not found in environment');
    process.exit(1);
}

async function fetchLinearTasks() {
    const client = new LinearClient({ apiKey: API_KEY });
    
    try {
        const me = await client.viewer;
        console.log(`\n👤 Connected as: ${me.name || me.email}\n`);
        
        // Get teams
        const teams = await client.teams();
        console.log(`📋 Teams: ${teams.nodes.map(t => t.key).join(', ')}\n`);
        
        // Fetch all issues
        const issues = await client.issues({
            filter: {
                state: {
                    name: { nin: ["Done", "Canceled"] }
                }
            },
            orderBy: "priority"
        });
        
        // Group by state
        const byState = {};
        for (const issue of issues.nodes) {
            const state = issue.state?.name || 'Unknown';
            if (!byState[state]) byState[state] = [];
            byState[state].push(issue);
        }
        
        // Display by state
        const stateOrder = ['In Progress', 'Todo', 'Triage', 'Backlog', 'Unknown'];
        
        for (const state of stateOrder) {
            if (byState[state] && byState[state].length > 0) {
                console.log(`📊 ${state.toUpperCase()} (${byState[state].length}):`);
                
                // Show top 10 from each state
                const topIssues = byState[state].slice(0, 10);
                for (const issue of topIssues) {
                    const priority = issue.priority ? `[P${issue.priority}]` : '';
                    const assignee = issue.assignee ? `@${issue.assignee.name}` : '[Unassigned]';
                    const labels = issue.labels ? (await issue.labels()).nodes.map(l => l.name).join(', ') : '';
                    const labelStr = labels ? ` 🏷️ ${labels}` : '';
                    
                    console.log(`  • ${issue.identifier}: ${issue.title} ${priority} ${assignee}${labelStr}`);
                }
                
                if (byState[state].length > 10) {
                    console.log(`  ... and ${byState[state].length - 10} more`);
                }
                console.log('');
            }
        }
        
        // Summary stats
        const total = issues.nodes.length;
        const inProgress = byState['In Progress']?.length || 0;
        const todo = byState['Todo']?.length || 0;
        const triage = byState['Triage']?.length || 0;
        
        console.log('📈 SUMMARY:');
        console.log(`  Total active issues: ${total}`);
        console.log(`  In Progress: ${inProgress}`);
        console.log(`  Todo: ${todo}`);
        console.log(`  Triage: ${triage}`);
        
        // High priority items
        console.log('\n🔥 HIGH PRIORITY ITEMS:');
        const highPriority = issues.nodes
            .filter(i => i.priority && i.priority <= 2)
            .slice(0, 5);
            
        for (const issue of highPriority) {
            const state = issue.state?.name || 'Unknown';
            const assignee = issue.assignee ? `@${issue.assignee.name}` : '[Unassigned]';
            console.log(`  • ${issue.identifier}: ${issue.title} [${state}] ${assignee}`);
        }
        
        // Suggested next tasks
        console.log('\n💡 SUGGESTED NEXT TASKS:');
        console.log('Based on priority and status, consider working on:');
        
        // Find unassigned high priority or in-progress items
        const suggestions = issues.nodes
            .filter(i => {
                const isHighPriority = i.priority && i.priority <= 2;
                const isInProgress = i.state?.name === 'In Progress';
                const isTodo = i.state?.name === 'Todo';
                const isUnassigned = !i.assignee;
                
                return (isHighPriority || isInProgress) && (isTodo || isInProgress);
            })
            .slice(0, 3);
            
        if (suggestions.length > 0) {
            for (const issue of suggestions) {
                const state = issue.state?.name || 'Unknown';
                const priority = issue.priority ? `P${issue.priority}` : 'No priority';
                console.log(`  1. ${issue.identifier}: ${issue.title}`);
                console.log(`     Status: ${state}, Priority: ${priority}`);
                console.log(`     URL: https://linear.app/issue/${issue.identifier}`);
                console.log('');
            }
        } else {
            console.log('  No high-priority unassigned tasks found.');
        }
        
    } catch (error) {
        console.error('Error fetching Linear tasks:', error.message);
        process.exit(1);
    }
}

fetchLinearTasks();