#!/usr/bin/env node

/**
 * Quick script to update a Linear issue state
 */

import { LinearClient } from '../dist/src/integrations/linear/client.js';
import chalk from 'chalk';

async function updateTaskState(identifier, stateName) {
  const apiKey = process.env.LINEAR_API_KEY;

  if (!apiKey) {
    console.error(chalk.red('LINEAR_API_KEY environment variable not set'));
    process.exit(1);
  }

  try {
    const client = new LinearClient({ apiKey });

    // Find the issue by identifier
    const issueNumber = parseInt(identifier.split('-')[1] || identifier);
    const teams = await client.getTeams();
    const teamKey = identifier.includes('-')
      ? identifier.split('-')[0]
      : teams[0].key;

    // Get team and workflow states
    const team = teams.find((t) => t.key === teamKey) || teams[0];
    const states = await client.getWorkflowStates(team.id);

    // Find the target state
    const targetState = states.find(
      (s) =>
        s.name.toLowerCase() === stateName.toLowerCase() ||
        s.type === stateName.toLowerCase()
    );

    if (!targetState) {
      console.log(chalk.yellow('Available states:'));
      states.forEach((s) => {
        console.log(`  - ${s.name} (${s.type})`);
      });
      throw new Error(`State "${stateName}" not found`);
    }

    // Find the issue
    const issues = await client.getIssues({ teamId: team.id, limit: 100 });
    const issue = issues.find(
      (i) => i.identifier === `${teamKey}-${issueNumber}`
    );

    if (!issue) {
      throw new Error(`Issue ${teamKey}-${issueNumber} not found`);
    }

    // Update the issue state
    const updatedIssue = await client.updateIssue(issue.id, {
      stateId: targetState.id,
    });

    console.log(chalk.green('✅ Issue updated successfully!'));
    console.log(chalk.cyan(`  ID: ${updatedIssue.identifier}`));
    console.log(chalk.cyan(`  Title: ${updatedIssue.title}`));
    console.log(chalk.cyan(`  State: ${updatedIssue.state.name}`));
    console.log(chalk.cyan(`  URL: ${updatedIssue.url}`));

    return updatedIssue;
  } catch (error) {
    console.error(chalk.red('Failed to update issue:'), error.message);
    process.exit(1);
  }
}

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(
    chalk.yellow('Usage: node update-linear-task.js <identifier> <state>')
  );
  console.log(
    chalk.gray('Example: node update-linear-task.js STA-48 "In Progress"')
  );
  console.log(
    chalk.gray('States: Backlog, Todo, "In Progress", Done, Canceled')
  );
  process.exit(1);
}

const identifier = args[0];
const state = args[1];

updateTaskState(identifier, state);
