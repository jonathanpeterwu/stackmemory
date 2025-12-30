#!/usr/bin/env node

/**
 * Script to merge duplicate Linear tasks
 * Keeps the lowest-numbered task as primary and marks others as duplicates
 */

import { LinearClient } from '@linear/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';

interface DuplicateGroup {
  name: string;
  taskIds: string[];
  primaryId: string;
}

const duplicateGroups: DuplicateGroup[] = [
  {
    name: 'Linear API Integration',
    taskIds: ['STA-88', 'STA-74', 'STA-61', 'STA-46', 'STA-32', 'STA-9'],
    primaryId: 'STA-9',
  },
  {
    name: 'Performance Optimization',
    taskIds: [
      'STA-87',
      'STA-73',
      'STA-60',
      'STA-45',
      'STA-31',
      'STA-13',
      'STA-21',
      'STA-35',
      'STA-50',
      'STA-63',
      'STA-77',
    ],
    primaryId: 'STA-13',
  },
  {
    name: 'Security Audit and Input Validation',
    taskIds: ['STA-85', 'STA-71', 'STA-58', 'STA-43', 'STA-29'],
    primaryId: 'STA-29',
  },
  {
    name: 'Implement Proper Error Handling',
    taskIds: ['STA-84', 'STA-70', 'STA-57', 'STA-42', 'STA-28'],
    primaryId: 'STA-28',
  },
  {
    name: 'Implement Comprehensive Testing Suite',
    taskIds: ['STA-83', 'STA-69', 'STA-56', 'STA-41', 'STA-27'],
    primaryId: 'STA-27',
  },
];

async function mergeDuplicateTasks() {
  console.log('🔄 Starting Linear duplicate task merge...\n');

  // Load Linear tokens
  const tokensPath = join(process.cwd(), '.stackmemory', 'linear-tokens.json');
  let accessToken: string;

  try {
    const tokensData = readFileSync(tokensPath, 'utf8');
    const tokens = JSON.parse(tokensData);
    accessToken = tokens.accessToken;
    console.log('✅ Loaded Linear authentication tokens\n');
  } catch (error) {
    console.error(
      '❌ Failed to load Linear tokens. Please run: stackmemory linear setup'
    );
    process.exit(1);
  }

  // Initialize Linear client
  const client = new LinearClient({
    apiKey: accessToken,
  });

  // Process each duplicate group
  for (const group of duplicateGroups) {
    console.log(`\n📋 Processing: ${group.name}`);
    console.log(`   Primary: ${group.primaryId}`);
    console.log(
      `   Duplicates: ${group.taskIds.filter((id) => id !== group.primaryId).join(', ')}`
    );

    try {
      // Get the primary issue
      const primaryIssue = await client.issue(group.primaryId);
      if (!primaryIssue) {
        console.log(
          `   ⚠️  Primary issue ${group.primaryId} not found, skipping group`
        );
        continue;
      }

      // Collect descriptions from all duplicates
      let combinedDescription = primaryIssue.description || '';
      const duplicateIds = group.taskIds.filter((id) => id !== group.primaryId);

      for (const duplicateId of duplicateIds) {
        try {
          const duplicateIssue = await client.issue(duplicateId);
          if (!duplicateIssue) {
            console.log(`   ⚠️  Issue ${duplicateId} not found, skipping`);
            continue;
          }

          // Add duplicate's description if it exists and differs
          if (
            duplicateIssue.description &&
            duplicateIssue.description !== primaryIssue.description
          ) {
            combinedDescription += `\n\n---\n[Merged from ${duplicateId}]\n${duplicateIssue.description}`;
          }

          // Get the canceled state for the team
          const team = await duplicateIssue.team;
          const states = await team.states();
          const canceledState = states.nodes.find((s) => s.type === 'canceled');

          if (!canceledState) {
            console.log(
              `   ⚠️  No 'canceled' state found for team, skipping ${duplicateId}`
            );
            continue;
          }

          // Update duplicate to canceled state with reference to primary
          await duplicateIssue.update({
            stateId: canceledState.id,
            description: `Duplicate of ${group.primaryId}\n\n${duplicateIssue.description || ''}`,
          });

          console.log(
            `   ✅ Marked ${duplicateId} as duplicate of ${group.primaryId}`
          );
        } catch (error: any) {
          console.log(
            `   ❌ Failed to process ${duplicateId}: ${error.message}`
          );
        }
      }

      // Update primary issue with combined description if changed
      if (combinedDescription !== primaryIssue.description) {
        await primaryIssue.update({
          description: combinedDescription,
        });
        console.log(
          `   ✅ Updated ${group.primaryId} with merged descriptions`
        );
      }

      console.log(`   ✅ Group "${group.name}" processed successfully`);
    } catch (error: any) {
      console.error(`   ❌ Error processing group: ${error.message}`);
    }
  }

  console.log('\n✨ Duplicate merge complete!');
  console.log('\n📊 Summary:');
  console.log(`   Groups processed: ${duplicateGroups.length}`);
  console.log(
    `   Total tasks affected: ${duplicateGroups.reduce((acc, g) => acc + g.taskIds.length, 0)}`
  );
  console.log(`   Primary tasks kept: ${duplicateGroups.length}`);
  console.log(
    `   Tasks marked as duplicate: ${duplicateGroups.reduce((acc, g) => acc + g.taskIds.length - 1, 0)}`
  );
}

// Run the merge
mergeDuplicateTasks().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
