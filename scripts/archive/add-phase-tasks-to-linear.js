#!/usr/bin/env node

/**
 * Add all StackMemory phase tasks to Linear via API
 */

import 'dotenv/config';
import fs from 'fs';
import { LinearRestClient } from '../dist/integrations/linear/rest-client.js';

const API_KEY = process.env.LINEAR_API_KEY;
if (!API_KEY) {
  console.error('❌ LINEAR_API_KEY environment variable not set');
  console.log('Please set LINEAR_API_KEY in your .env file or export it in your shell');
  process.exit(1);
}
const DELAY_BETWEEN_TASKS = 5000; // 5 seconds to avoid rate limits

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function addTasksToLinear() {
  try {
    console.log('🚀 Starting to add StackMemory phase tasks to Linear...');
    
    // Read the generated tasks
    const tasksFile = `stackmemory-phase-tasks-${new Date().toISOString().split('T')[0]}.json`;
    if (!fs.existsSync(tasksFile)) {
      throw new Error(`Tasks file not found: ${tasksFile}`);
    }
    
    const taskData = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
    console.log(`📋 Found ${taskData.totalTasks} tasks to create`);
    
    const client = new LinearRestClient(API_KEY);
    
    // Get team info
    console.log('🔍 Getting team information...');
    const team = await client.getTeam();
    console.log(`🎯 Target team: ${team.name} (${team.key})`);
    
    let created = 0;
    let failed = 0;
    const results = [];
    
    // Process each phase
    for (const [phaseName, tasks] of Object.entries(taskData.phases)) {
      console.log(`\n📦 Processing ${phaseName} (${tasks.length} tasks)`);
      
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        console.log(`\n⏳ Creating task ${i + 1}/${tasks.length}: ${task.title}`);
        
        try {
          // Create task via GraphQL
          const createQuery = `
            mutation CreateIssue($input: IssueCreateInput!) {
              issueCreate(input: $input) {
                success
                issue {
                  id
                  identifier
                  title
                  state { name }
                  priority
                  url
                }
              }
            }
          `;
          
          const taskInput = {
            title: task.title.replace('STA-XXX:', '').trim(), // Remove placeholder ID
            description: task.description,
            teamId: team.id,
            priority: task.priority
          };
          
          const response = await client.makeRequest(createQuery, { input: taskInput });
          
          if (response.data?.issueCreate?.success) {
            const createdTask = response.data.issueCreate.issue;
            console.log(`✅ Created: ${createdTask.identifier} - ${createdTask.title}`);
            console.log(`   URL: ${createdTask.url}`);
            
            results.push({
              original: task.title,
              created: createdTask.identifier,
              url: createdTask.url,
              success: true
            });
            created++;
          } else {
            const errors = response.data?.issueCreate?.errors || [{ message: 'Unknown error' }];
            throw new Error(errors[0].message);
          }
          
          // Delay to avoid rate limits (except for last task)
          if (i < tasks.length - 1) {
            console.log(`⏳ Waiting ${DELAY_BETWEEN_TASKS / 1000}s to avoid rate limits...`);
            await delay(DELAY_BETWEEN_TASKS);
          }
          
        } catch (error) {
          console.log(`❌ Failed: ${error.message}`);
          results.push({
            original: task.title,
            error: error.message,
            success: false
          });
          failed++;
          
          // If rate limited, wait longer and continue
          if (error.message.includes('usage limit') || error.message.includes('rate limit')) {
            console.log('🚫 Hit rate limit. Waiting 60 seconds...');
            await delay(60000);
          }
        }
      }
    }
    
    // Summary
    console.log('\n📊 Creation Summary:');
    console.log(`✅ Successfully created: ${created} tasks`);
    console.log(`❌ Failed: ${failed} tasks`);
    console.log(`📈 Success rate: ${Math.round((created / (created + failed)) * 100)}%`);
    
    // Save results
    const resultsFile = `linear-task-creation-results-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(resultsFile, JSON.stringify({
      summary: { created, failed, total: created + failed },
      results: results,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    console.log(`💾 Results saved to: ${resultsFile}`);
    
    if (created > 0) {
      console.log('\n🎉 Success! StackMemory phase tasks have been added to Linear.');
      console.log('💡 Next steps:');
      console.log('   1. Review and organize tasks in Linear workspace');
      console.log('   2. Start with high-priority Phase 2 tasks');
      console.log('   3. Assign tasks to team members');
      console.log('   4. Begin implementation of LLM-driven context retrieval');
    }
    
    if (failed > 0) {
      console.log('\n⚠️  Some tasks failed to create. Check the results file for details.');
      console.log('   You can retry failed tasks manually using:');
      console.log('   node dist/cli/index.js linear:create --api-key <key> --title "..." --description "..."');
    }
    
  } catch (error) {
    console.error('💥 Script failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  addTasksToLinear().catch(console.error);
}

export { addTasksToLinear };