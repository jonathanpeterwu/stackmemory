#!/usr/bin/env node
/**
 * Create cleanup issues in Linear
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TEAM_ID = 'STA'; // Stackmemoryai team

const cleanupTasks = [
  {
    title: 'Add tests for monitoring module (0% coverage)',
    description: `## Problem
The \`/src/core/monitoring/\` module has 0% test coverage.

## Files affected
- src/core/monitoring/logger.ts
- src/core/monitoring/health-check.ts
- src/core/monitoring/metrics-collector.ts
- src/core/monitoring/performance-tracker.ts
- src/core/monitoring/index.ts

## Acceptance criteria
- [ ] Add unit tests for all public functions
- [ ] Test error handling paths
- [ ] Achieve >80% coverage`,
    priority: 2, // High
    labels: ['tech-debt', 'testing'],
  },
  {
    title: 'Add tests for performance module (0% coverage)',
    description: `## Problem
The \`/src/core/performance/\` module has 0% test coverage.

## Files affected
- src/core/performance/profiler.ts
- src/core/performance/metrics.ts
- src/core/performance/index.ts

## Acceptance criteria
- [ ] Add unit tests for profiler
- [ ] Add unit tests for metrics collection
- [ ] Achieve >80% coverage`,
    priority: 2, // High
    labels: ['tech-debt', 'testing'],
  },
  {
    title: 'Add tests for session module (0% coverage)',
    description: `## Problem
The \`/src/core/session/\` module has 0% test coverage.

## Files affected
- src/core/session/session-manager.ts
- src/core/session/enhanced-handoff.ts
- src/core/session/index.ts

## Acceptance criteria
- [ ] Add unit tests for session lifecycle
- [ ] Add unit tests for handoff
- [ ] Achieve >80% coverage`,
    priority: 2, // High
    labels: ['tech-debt', 'testing'],
  },
  {
    title: 'Add tests for claude-code integration (7 files, 0% coverage)',
    description: `## Problem
The \`/src/integrations/claude-code/\` module has no tests.

## Files affected
- src/integrations/claude-code/agent-bridge.ts
- src/integrations/claude-code/context-injector.ts
- src/integrations/claude-code/hook-manager.ts
- src/integrations/claude-code/index.ts
- src/integrations/claude-code/mcp-client.ts
- src/integrations/claude-code/session-detector.ts
- src/integrations/claude-code/types.ts

## Acceptance criteria
- [ ] Add unit tests for all modules
- [ ] Mock external dependencies
- [ ] Achieve >80% coverage`,
    priority: 2, // High
    labels: ['tech-debt', 'testing'],
  },
  {
    title: 'Improve trace module test coverage (9%)',
    description: `## Problem
The \`/src/core/trace/\` module has only ~9% test coverage.

## Files affected (11 files)
- src/core/trace/trace-detector.ts
- src/core/trace/trace-bundler.ts
- src/core/trace/pattern-matcher.ts
- And 8 more...

## Acceptance criteria
- [ ] Add tests for trace detection
- [ ] Add tests for pattern matching
- [ ] Add tests for trace bundling
- [ ] Achieve >80% coverage`,
    priority: 3, // Medium
    labels: ['tech-debt', 'testing'],
  },
  {
    title: 'Reorganize scripts directory (112 files)',
    description: `## Problem
The \`/scripts/\` directory has 112 files with no clear organization.

## Proposed structure
\`\`\`
scripts/
  setup/        # Installation & configuration
  test/         # Test runners
  cli/          # CLI wrappers
  maintenance/  # Cleanup & sync tasks
  demos/        # Demo & example scripts (DONE)
  archive/      # Archived scripts
\`\`\`

## Acceptance criteria
- [ ] Create subdirectories
- [ ] Move scripts to appropriate directories
- [ ] Update any references in package.json
- [ ] Update documentation`,
    priority: 4, // Low
    labels: ['tech-debt', 'organization'],
  },
  {
    title: 'Remove ESLint blanket exclusion of /src/integrations/',
    description: `## Problem
ESLint config (line 55) excludes entire \`/src/integrations/\` directory from linting.

## Impact
- Potential code quality issues not caught
- Inconsistent code style
- 33 warnings not shown

## Acceptance criteria
- [ ] Remove blanket exclusion from eslint.config.js
- [ ] Fix any lint errors that appear
- [ ] Keep specific exclusions only if truly needed`,
    priority: 3, // Medium
    labels: ['tech-debt', 'code-quality'],
  },
  {
    title: 'Resolve service duplication (context-service.ts)',
    description: `## Problem
\`context-service.ts\` exists in two locations with different implementations:
- /src/services/context-service.ts
- /src/daemon/services/context-service.ts

## Acceptance criteria
- [ ] Analyze both implementations
- [ ] Rename daemon version to DaemonContextService or consolidate
- [ ] Update all imports
- [ ] Document the difference if both needed`,
    priority: 3, // Medium
    labels: ['tech-debt', 'organization'],
  },
  {
    title: 'Rename temporary-named files (refactored-*, enhanced-*)',
    description: `## Problem
Several files have temporary-sounding names:
- refactored-frame-manager.ts
- enhanced-hybrid-digest.ts
- enhanced-rehydration.ts
- enhanced-handoff.ts

## Acceptance criteria
- [ ] Rename to final names (remove prefix)
- [ ] Update all imports
- [ ] Verify tests pass`,
    priority: 4, // Low
    labels: ['tech-debt', 'naming'],
  },
  {
    title: 'Add documentation for monitoring, trace, and performance modules',
    description: `## Problem
Critical modules lack documentation:
- /src/core/monitoring/ - no docs
- /src/core/trace/ - demos but no guide
- /src/core/performance/ - no docs

## Acceptance criteria
- [ ] Add README.md or docs for each module
- [ ] Document public APIs
- [ ] Add usage examples`,
    priority: 4, // Low
    labels: ['documentation'],
  },
];

async function queryLinear(query, variables = {}) {
  const apiKey =
    process.env.STACKMEMORY_LINEAR_API_KEY || process.env.LINEAR_API_KEY;
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await response.json();
  if (data.errors) {
    throw new Error(data.errors[0].message);
  }
  return data.data;
}

async function getTeamId() {
  const teams = await queryLinear(`
    query {
      teams {
        nodes {
          id
          key
          name
        }
      }
    }
  `);

  const team = teams.teams.nodes.find((t) => t.key === TEAM_ID);
  if (!team) {
    throw new Error(`Team ${TEAM_ID} not found`);
  }
  return team.id;
}

async function createIssue(teamId, task) {
  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          title
          url
        }
      }
    }
  `;

  const result = await queryLinear(mutation, {
    input: {
      teamId,
      title: task.title,
      description: task.description,
      priority: task.priority,
    },
  });

  return result.issueCreate;
}

async function main() {
  const apiKey =
    process.env.STACKMEMORY_LINEAR_API_KEY || process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error('❌ LINEAR_API_KEY not set');
    process.exit(1);
  }

  console.log('🔄 Connecting to Linear...');

  // Verify connection
  const viewer = await queryLinear('{ viewer { name email } }');
  console.log(`✅ Connected as: ${viewer.viewer.name}`);

  // Get team ID
  const teamId = await getTeamId();
  console.log(`📋 Team: ${TEAM_ID} (${teamId})\n`);

  // Create issues
  console.log(`Creating ${cleanupTasks.length} cleanup issues...\n`);

  for (const task of cleanupTasks) {
    try {
      const result = await createIssue(teamId, task);
      if (result.success) {
        console.log(`✅ ${result.issue.identifier}: ${task.title}`);
        console.log(`   ${result.issue.url}\n`);
      } else {
        console.log(`❌ Failed: ${task.title}`);
      }
    } catch (error) {
      console.log(`❌ Error creating "${task.title}": ${error.message}`);
    }
  }

  console.log('✅ Done!');
}

main().catch(console.error);
