#!/usr/bin/env node

/**
 * Quick script to create a Linear issue for tracking work
 */

import { LinearClient } from '../dist/src/integrations/linear/client.js';
import chalk from 'chalk';

async function createTask(title, description, priority = 3) {
  const apiKey = process.env.LINEAR_API_KEY;
  
  if (!apiKey) {
    console.error(chalk.red('LINEAR_API_KEY environment variable not set'));
    process.exit(1);
  }

  try {
    const client = new LinearClient({ apiKey });

    // Get the first team
    const teams = await client.getTeams();
    if (!teams || teams.length === 0) {
      throw new Error('No teams found');
    }

    const teamId = teams[0].id;
    console.log(chalk.cyan(`Using team: ${teams[0].name} (${teams[0].key})`));

    // Create the issue
    const issue = await client.createIssue({
      title,
      description,
      teamId,
      priority, // 0=urgent, 1=high, 2=medium, 3=normal, 4=low
    });

    console.log(chalk.green('✅ Issue created successfully!'));
    console.log(chalk.cyan(`  ID: ${issue.identifier}`));
    console.log(chalk.cyan(`  Title: ${issue.title}`));
    console.log(chalk.cyan(`  URL: ${issue.url}`));
    console.log(chalk.cyan(`  State: ${issue.state.name}`));

    return issue;
  } catch (error) {
    console.error(chalk.red('Failed to create issue:'), error.message);
    process.exit(1);
  }
}

// Get command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(
    chalk.yellow(
      'Usage: node create-linear-task.js "Title" "Description" [priority]'
    )
  );
  console.log(
    chalk.gray('Priority: 0=urgent, 1=high, 2=medium, 3=normal, 4=low')
  );
  process.exit(1);
}

const title = args[0];
const description = args[1] || '';
const priority = args[2] ? parseInt(args[2]) : 3;

createTask(title, description, priority);
