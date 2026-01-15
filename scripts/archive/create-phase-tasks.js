#!/usr/bin/env node

/**
 * Create Linear tasks for uncompleted StackMemory phases
 */

import fs from 'fs';

// Phase tasks to be created in Linear
const phaseTasks = {
  "Phase 2: Intelligence Layer": [
    {
      title: "STA-301: Implement LLM-Driven Context Retrieval",
      description: `Implement smart context retrieval using LLM analysis as specified in SPEC.md Section 4.1

## Acceptance Criteria
- [ ] Create compressed summary generation for recent sessions
- [ ] Implement LLM analysis of context queries  
- [ ] Build queryable indices (by error type, timeframe, contributor)
- [ ] Add visible/auditable reasoning output
- [ ] Support natural language and structured queries
- [ ] Target p50 latency: 50ms, p99: 500ms

## Technical Details
- Replace current simple retrieval with LLM-driven analysis
- Support query language from SPEC.md Section 4.2
- Generate compressed summaries for LLM input
- Implement confidence scoring for retrieval results

Priority: High
Estimate: 8 points`,
      priority: 2
    },
    {
      title: "STA-302: Complete Hybrid Digest Generation (60/40 Split)",
      description: `Finalize the hybrid digest generation system with 60% deterministic, 40% AI-generated content

## Current Status
- ✅ EnhancedHybridDigestGenerator implemented
- ⚠️  Needs optimization and production readiness

## Acceptance Criteria  
- [ ] Ensure 60% deterministic fields work correctly
- [ ] Optimize AI summary generation (max 200 tokens)
- [ ] Add batch processing during idle time
- [ ] Implement fallback to deterministic-only mode
- [ ] Add digest quality metrics and validation

## Technical Details
- Review current implementation in enhanced-hybrid-digest.ts
- Add performance monitoring for digest generation
- Implement proper error handling and fallbacks
- Add configuration for digest generation timing

Priority: Medium
Estimate: 5 points`,
      priority: 3
    },
    {
      title: "STA-303: Implement Smart Trace Detection and Bundling",
      description: `Build intelligent trace detection to bundle related tool calls as specified in SPEC.md Section 4.3

## Acceptance Criteria
- [ ] Detect chains of related tool calls within 30s proximity
- [ ] Bundle tools targeting same file/directory
- [ ] Identify causal relationships (error → fix → test)
- [ ] Compress traces with single scoring using max(all_tools)
- [ ] Add trace boundary detection algorithms

## Examples
- Raw: "Search → Read(10) → Edit(3) → Test → Fix → Test"  
- Compressed: "Fixed auth bug via search-driven refactor [0.95]"

## Technical Details
- Implement time proximity detection (30s window)
- Build causal relationship analysis
- Create trace compression algorithms
- Add trace scoring and bundling logic

Priority: Medium  
Estimate: 6 points`,
      priority: 3
    },
    {
      title: "STA-304: Implement Configurable Tool Scoring System", 
      description: `Build flexible tool scoring system with weight profiles as specified in SPEC.md Section 3

## Acceptance Criteria
- [ ] Implement base tool scores from SPEC (search: 0.95, edit: 0.50, etc.)
- [ ] Add configurable weight system (base: 0.4, impact: 0.3, etc.)
- [ ] Create predefined profiles (security_focused, exploration_heavy, production_system)
- [ ] Support per-project score customization
- [ ] Add scoring formula with multipliers and bonuses

## Technical Details  
- Extend current ToolScoringMiddleware
- Implement weight profiles in config system
- Add runtime score calculation with configurable weights
- Support custom tool score overrides per project
- Add scoring analytics and metrics

Priority: Low
Estimate: 4 points`,
      priority: 4
    }
  ],

  "Phase 3: Collaboration": [
    {
      title: "STA-305: Implement Dual Stack Architecture (Individual + Shared)",
      description: `Build dual stack system supporting individual and shared team stacks as specified in SPEC.md Section 7.1

## Acceptance Criteria
- [ ] Create individual stacks with private visibility
- [ ] Create shared team stacks with team visibility  
- [ ] Implement frame promotion from individual to shared
- [ ] Support fork/merge operations between stacks
- [ ] Track participants and contributors properly
- [ ] Add stack interaction patterns (promote, fork, merge)

## Technical Details
- Extend current stack management for multiple stack types
- Implement visibility and permission controls
- Add frame promotion and fork/merge logic
- Create team stack management APIs
- Build stack interaction workflows

Priority: High
Estimate: 12 points`,
      priority: 2
    },
    {
      title: "STA-306: Build Frame Handoff Mechanism with Ownership Tracking",
      description: `Implement frame handoff system for team collaboration as specified in SPEC.md Section 7.2

## Acceptance Criteria
- [ ] Track frame ownership (creator, contributors, last_active)
- [ ] Support explicit handoff via command
- [ ] Handle implicit handoff when someone continues work  
- [ ] Auto-release frames after 24h idle time
- [ ] Implement frame locking to prevent conflicts
- [ ] Send notifications on handoff events

## Technical Details
- Extend frame metadata with ownership information
- Build handoff command interface
- Implement idle timeout and auto-release
- Add conflict prevention during active work
- Create team awareness notifications
- Add frame subscription system

Priority: High
Estimate: 10 points`,
      priority: 2
    },
    {
      title: "STA-307: Implement Merge Conflict Resolution for Shared Frames",
      description: `Build merge conflict resolution system for collaborative frame editing

## Acceptance Criteria
- [ ] Detect conflicting edits to shared frames
- [ ] Provide merge conflict resolution UI/CLI
- [ ] Support manual and automatic conflict resolution
- [ ] Maintain audit trail of conflict resolutions
- [ ] Add rollback capabilities for failed merges

## Technical Details
- Implement frame diff and conflict detection
- Build merge resolution algorithms
- Create CLI interface for conflict resolution
- Add automatic resolution for non-conflicting changes
- Implement merge history and audit logging

Priority: Medium
Estimate: 8 points`,
      priority: 3
    },
    {
      title: "STA-308: Build Team Analytics and Collaboration Metrics",
      description: `Create analytics dashboard for team collaboration insights

## Acceptance Criteria
- [ ] Track frame collaboration patterns
- [ ] Show handoff frequency and success rates
- [ ] Display team productivity metrics
- [ ] Add frame ownership and contribution analytics
- [ ] Generate team collaboration reports

## Technical Details
- Extend current analytics system for team metrics
- Add collaboration pattern detection
- Build team dashboard components
- Implement collaboration scoring algorithms
- Create reporting and export capabilities

Priority: Low
Estimate: 6 points`,
      priority: 4
    }
  ],

  "Phase 4: Scale & Enterprise": [
    {
      title: "STA-309: Implement Remote Infinite Storage System",
      description: `Build remote storage system for infinite retention as specified in SPEC.md Section 2.1

## Acceptance Criteria
- [ ] Implement TimeSeries DB + S3 backend storage
- [ ] Add Redis cache layer for fast retrieval
- [ ] Build automatic migration from local to remote
- [ ] Support multiple storage tiers (hot/warm/cold/archive)
- [ ] Achieve target latencies: p50: 50ms, p99: 500ms

## Technical Details
- Integrate ClickHouse/TimescaleDB for timeseries data
- Implement S3 storage with lifecycle management  
- Build Redis caching with intelligent prefetching
- Add background migration workers
- Create storage tier management system

Priority: High
Estimate: 15 points`,
      priority: 2
    },
    {
      title: "STA-310: Build Incremental Garbage Collection System", 
      description: `Implement incremental GC to avoid stop-the-world pauses as specified in SPEC.md Section 5

## Current Status  
- ⚠️  Phase 4 task mentioned in existing Linear tasks but not implemented

## Acceptance Criteria
- [ ] Process 100 frames per cycle every 60 seconds
- [ ] Implement generational strategies (young, mature, old)
- [ ] Protect current session, pinned frames, unsynced changes
- [ ] Evict low-score and orphaned frames first
- [ ] Handle frame corruption recovery at any depth
- [ ] Add integrity checks during idle time

## Technical Details
- Build incremental GC scheduler
- Implement generational collection strategies
- Add frame protection mechanisms
- Create corruption detection and recovery
- Build idle-time integrity verification

Priority: Medium
Estimate: 10 points`,
      priority: 3
    },
    {
      title: "STA-311: Performance Optimization and SLA Achievement",
      description: `Optimize system performance to meet SPEC.md targets in Section 11

## Target SLAs
- [ ] Retrieval: p50: 50ms, p95: 200ms, p99: 500ms
- [ ] Storage: 10K events/sec write throughput  
- [ ] Batch upload: 100MB/min
- [ ] Uptime: 99.9%
- [ ] Max frames: 10,000 per project

## Acceptance Criteria
- [ ] Profile and optimize hot paths
- [ ] Implement connection pooling and caching
- [ ] Add performance monitoring and alerting
- [ ] Optimize database queries and indexes
- [ ] Implement horizontal scaling capabilities

Priority: Medium
Estimate: 8 points`,
      priority: 3
    },
    {
      title: "STA-312: Enterprise Security and Privacy Features",
      description: `Implement enterprise-grade security features as specified in SPEC.md Section 10

## Acceptance Criteria
- [ ] Add real-time secret detection with pattern matching
- [ ] Implement AES-256 encryption at rest
- [ ] Add TLS 1.3 encryption in transit
- [ ] Build configurable data residency controls
- [ ] Add audit trails and compliance reporting
- [ ] Implement GDPR/CCPA data deletion

## Technical Details
- Integrate secret scanning engines
- Add encryption key management
- Build compliance reporting system
- Implement data residency configuration
- Create audit logging and retention policies

Priority: Low
Estimate: 12 points`,
      priority: 4
    }
  ],

  "Code Quality & Maintenance": [
    {
      title: "STA-313: Complete All TODO Comments and Code Cleanup",
      description: `Address all TODO comments found in codebase and improve code quality

## Found TODOs to Address
- [ ] MCP Linear handlers: Implement updateLinearIssue, getLinearIssues methods
- [ ] Context handlers: Implement getRelevantContext method  
- [ ] Task store: Implement due dates functionality
- [ ] Frame corruption handling improvements
- [ ] Test coverage for incomplete modules

## Acceptance Criteria
- [ ] Resolve all TODO/FIXME/XXX comments in code
- [ ] Add comprehensive JSDoc documentation
- [ ] Improve test coverage to >90%
- [ ] Add integration tests for all major workflows
- [ ] Update API documentation

Priority: Medium
Estimate: 6 points`,
      priority: 3
    },
    {
      title: "STA-314: Improve Error Handling and System Resilience",
      description: `Enhance error handling, logging, and system resilience

## Acceptance Criteria
- [ ] Add comprehensive error handling for all async operations
- [ ] Implement circuit breakers for external service calls
- [ ] Add proper logging levels and structured logging
- [ ] Build retry mechanisms with exponential backoff
- [ ] Add health checks and monitoring endpoints

## Technical Details
- Standardize error handling patterns
- Add monitoring and alerting for critical failures
- Implement graceful degradation for service outages
- Build automated recovery mechanisms
- Add comprehensive logging and tracing

Priority: Medium
Estimate: 5 points`,
      priority: 3
    }
  ]
};

// Generate tasks file
const output = {
  generated: new Date().toISOString(),
  totalTasks: 0,
  phases: {}
};

for (const [phase, tasks] of Object.entries(phaseTasks)) {
  output.phases[phase] = tasks;
  output.totalTasks += tasks.length;
}

// Write to file
const filename = `stackmemory-phase-tasks-${new Date().toISOString().split('T')[0]}.json`;
fs.writeFileSync(filename, JSON.stringify(output, null, 2));

console.log(`✅ Generated ${output.totalTasks} phase tasks across ${Object.keys(phaseTasks).length} phases`);
console.log(`📄 Saved to: ${filename}`);

// Show summary
console.log('\n📋 Task Summary by Phase:');
for (const [phase, tasks] of Object.entries(phaseTasks)) {
  console.log(`  ${phase}: ${tasks.length} tasks`);
}

// Show priority breakdown
const priorityCounts = Object.values(phaseTasks).flat().reduce((acc, task) => {
  const priority = task.priority;
  acc[priority] = (acc[priority] || 0) + 1;
  return acc;
}, {});

console.log('\n🎯 Priority Distribution:');
console.log(`  High Priority (2): ${priorityCounts[2] || 0} tasks`);
console.log(`  Medium Priority (3): ${priorityCounts[3] || 0} tasks`);
console.log(`  Low Priority (4): ${priorityCounts[4] || 0} tasks`);

console.log('\n💡 Next Steps:');
console.log('  1. Wait for Linear rate limits to reset');
console.log('  2. Use the task creation commands to add these to Linear:');
console.log('     node dist/cli/index.js linear:create --api-key <key> --title "..." --description "..." --priority N');
console.log('  3. Start with Phase 2 high priority tasks for immediate impact');