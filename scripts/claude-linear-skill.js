#!/usr/bin/env node

/**
 * Claude Linear Update Skill
 * Automatically updates Linear tasks based on Claude's work
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config({ 
  path: path.join(__dirname, '..', '.env'),
  override: true,
  silent: true
});

class LinearUpdateSkill {
  constructor() {
    this.apiKey = process.env.LINEAR_API_KEY;
    this.graphqlUrl = 'https://api.linear.app/graphql';
    this.logFile = path.join(process.env.HOME, '.stackmemory', 'logs', 'linear-skill.log');
    
    // State mappings
    this.stateMap = {
      'todo': 'backlog',
      'backlog': 'backlog',
      'in_progress': 'started',
      'in progress': 'started',
      'started': 'started',
      'completed': 'completed',
      'done': 'completed',
      'finished': 'completed',
      'implemented': 'completed',
      'blocked': 'blocked',
      'cancelled': 'cancelled',
      'canceled': 'cancelled',
    };
  }

  /**
   * Parse task identifier from text
   */
  parseTaskId(text) {
    // Match STA-XXX pattern
    const staMatch = text.match(/STA-(\d+)/i);
    if (staMatch) {
      return { identifier: staMatch[0].toUpperCase(), type: 'identifier' };
    }

    // Match Linear URL
    const urlMatch = text.match(/linear\.app\/[^\/]+\/issue\/([^\/\s]+)/);
    if (urlMatch) {
      return { identifier: urlMatch[1], type: 'identifier' };
    }

    // Match UUID pattern
    const uuidMatch = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    if (uuidMatch) {
      return { identifier: uuidMatch[0], type: 'id' };
    }

    return null;
  }

  /**
   * Detect status from text
   */
  detectStatus(text) {
    const lowerText = text.toLowerCase();
    
    // Check for explicit status keywords
    for (const [keyword, status] of Object.entries(this.stateMap)) {
      if (lowerText.includes(keyword)) {
        return status;
      }
    }

    // Check for action keywords
    if (lowerText.includes('implement') || lowerText.includes('complet') || 
        lowerText.includes('done') || lowerText.includes('finish')) {
      return 'completed';
    }
    
    if (lowerText.includes('start') || lowerText.includes('working on') || 
        lowerText.includes('in progress')) {
      return 'started';
    }
    
    if (lowerText.includes('block')) {
      return 'blocked';
    }

    return null;
  }

  /**
   * Extract implementation details from text
   */
  extractImplementationDetails(text) {
    const details = [];
    
    // Extract features
    const featuresMatch = text.match(/(?:features?|implemented?|added?)[::\s]*([\s\S]*?)(?=\n\n|\n[A-Z]|$)/i);
    if (featuresMatch) {
      details.push('## Implementation Details\n' + featuresMatch[1].trim());
    }

    // Extract technical details
    const techMatch = text.match(/(?:technical|implementation)[::\s]*([\s\S]*?)(?=\n\n|\n[A-Z]|$)/i);
    if (techMatch) {
      details.push('## Technical Implementation\n' + techMatch[1].trim());
    }

    // Extract file changes
    const filesMatch = text.match(/(?:files?|created?|modified?)[::\s]*([\s\S]*?)(?=\n\n|\n[A-Z]|$)/i);
    if (filesMatch) {
      details.push('## Files Changed\n' + filesMatch[1].trim());
    }

    // Add timestamp
    details.push(`\n---\n_Updated by Claude: ${new Date().toISOString()}_`);

    return details.join('\n\n');
  }

  /**
   * Get Linear issue by identifier
   */
  async getIssue(identifier) {
    const query = `
      query GetIssue($identifier: String!) {
        issue(id: $identifier) {
          id
          identifier
          title
          description
          state {
            id
            name
            type
          }
        }
      }
    `;

    try {
      const response = await fetch(this.graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.apiKey,
        },
        body: JSON.stringify({
          query,
          variables: { identifier },
        }),
      });

      const data = await response.json();
      
      if (data.errors) {
        this.log(`Error fetching issue: ${data.errors[0].message}`, 'ERROR');
        return null;
      }

      return data.data.issue;
    } catch (error) {
      this.log(`Failed to fetch issue: ${error.message}`, 'ERROR');
      return null;
    }
  }

  /**
   * Get Linear state ID by name
   */
  async getStateId(stateName) {
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

    try {
      const response = await fetch(this.graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.apiKey,
        },
        body: JSON.stringify({ query }),
      });

      const data = await response.json();
      
      if (data.errors) {
        this.log(`Error fetching states: ${data.errors[0].message}`, 'ERROR');
        return null;
      }

      const states = data.data.workflowStates.nodes;
      const state = states.find(s => s.type === stateName || s.name.toLowerCase() === stateName);
      
      return state ? state.id : null;
    } catch (error) {
      this.log(`Failed to fetch states: ${error.message}`, 'ERROR');
      return null;
    }
  }

  /**
   * Update Linear issue
   */
  async updateIssue(issueId, updates) {
    const mutation = `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id
            identifier
            title
            state {
              name
            }
          }
        }
      }
    `;

    try {
      const response = await fetch(this.graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.apiKey,
        },
        body: JSON.stringify({
          query: mutation,
          variables: {
            id: issueId,
            input: updates,
          },
        }),
      });

      const data = await response.json();
      
      if (data.errors) {
        this.log(`Error updating issue: ${data.errors[0].message}`, 'ERROR');
        return false;
      }

      if (data.data.issueUpdate.success) {
        const issue = data.data.issueUpdate.issue;
        this.log(`Updated ${issue.identifier}: ${issue.state.name}`);
        return true;
      }

      return false;
    } catch (error) {
      this.log(`Failed to update issue: ${error.message}`, 'ERROR');
      return false;
    }
  }

  /**
   * Process update request
   */
  async processUpdate(text, options = {}) {
    // Parse task ID
    const taskInfo = this.parseTaskId(text);
    if (!taskInfo) {
      this.log('No task identifier found in text');
      return { success: false, reason: 'No task identifier found' };
    }

    this.log(`Processing update for ${taskInfo.identifier}`);

    // Get issue details
    const issue = await this.getIssue(taskInfo.identifier);
    if (!issue) {
      return { success: false, reason: 'Issue not found' };
    }

    // Prepare updates
    const updates = {};

    // Detect and set new status
    const newStatus = options.status || this.detectStatus(text);
    if (newStatus) {
      const stateId = await this.getStateId(newStatus);
      if (stateId) {
        updates.stateId = stateId;
        this.log(`Setting status to ${newStatus}`);
      }
    }

    // Add implementation details if completing
    if (newStatus === 'completed' && options.addDetails !== false) {
      const details = this.extractImplementationDetails(text);
      if (details) {
        updates.description = issue.description + '\n\n' + details;
        this.log('Adding implementation details');
      }
    }

    // Add comment if provided
    if (options.comment) {
      updates.comment = {
        body: options.comment,
      };
    }

    // Update the issue
    if (Object.keys(updates).length > 0) {
      const success = await this.updateIssue(issue.id, updates);
      return {
        success,
        issue: issue.identifier,
        updates: Object.keys(updates),
      };
    }

    return { success: false, reason: 'No updates to apply' };
  }

  /**
   * Log message
   */
  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    
    console.log(level === 'ERROR' ? chalk.red(message) : chalk.green(message));
    
    try {
      fs.appendFileSync(this.logFile, logMessage);
    } catch {
      // Silent fail
    }
  }

  /**
   * Batch update multiple tasks
   */
  async batchUpdate(updates) {
    const results = [];
    
    for (const update of updates) {
      const result = await this.processUpdate(update.text, update.options);
      results.push({
        ...result,
        original: update,
      });
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return results;
  }
}

// CLI interface
async function main() {
  const skill = new LinearUpdateSkill();
  
  if (!skill.apiKey) {
    console.error(chalk.red('LINEAR_API_KEY not found in environment'));
    process.exit(1);
  }

  const command = process.argv[2];
  const args = process.argv.slice(3).join(' ');

  if (!command) {
    console.log(chalk.yellow('Linear Update Skill'));
    console.log('Usage:');
    console.log('  claude-linear-skill update <text>  - Update task from text');
    console.log('  claude-linear-skill detect <text>  - Detect task and status');
    console.log('  claude-linear-skill test           - Test connection');
    console.log();
    console.log('Examples:');
    console.log('  claude-linear-skill update "STA-287 is completed with infinite storage"');
    console.log('  claude-linear-skill update "Starting work on STA-288"');
    process.exit(0);
  }

  switch (command) {
    case 'update':
      if (!args) {
        console.error(chalk.red('Please provide update text'));
        process.exit(1);
      }
      
      const result = await skill.processUpdate(args);
      if (result.success) {
        console.log(chalk.green(`✅ Updated ${result.issue}`));
        console.log('Updates:', result.updates.join(', '));
      } else {
        console.log(chalk.red(`❌ Update failed: ${result.reason}`));
      }
      break;

    case 'detect':
      if (!args) {
        console.error(chalk.red('Please provide text to analyze'));
        process.exit(1);
      }
      
      const taskId = skill.parseTaskId(args);
      const status = skill.detectStatus(args);
      
      console.log('Detected:');
      console.log(`  Task: ${taskId ? taskId.identifier : 'Not found'}`);
      console.log(`  Status: ${status || 'Not detected'}`);
      break;

    case 'test':
      const testResult = await skill.getStateId('backlog');
      if (testResult) {
        console.log(chalk.green('✅ Linear API connection successful'));
      } else {
        console.log(chalk.red('❌ Linear API connection failed'));
      }
      break;

    default:
      console.error(chalk.red(`Unknown command: ${command}`));
      process.exit(1);
  }
}

// Export for use in other scripts
export { LinearUpdateSkill };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  });
}