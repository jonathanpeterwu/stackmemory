# Session Persistence Architecture for StackMemory

## Problem Statement
Current implementation creates a new run_id for each CLI invocation, causing:
- Status commands showing 0 frames despite active work
- Loss of context between CLI calls
- Inability to resume work across sessions
- No visibility into frames from other sessions

## Proposed Solution

### 1. Session Management Layer

#### Session Store (`~/.stackmemory/sessions/`)
```yaml
Structure:
  ~/.stackmemory/sessions/
    ├── current.json         # Points to active session
    ├── {project-hash}/      # Per-project sessions
    │   ├── active.json      # Active session for project
    │   └── history/         # Historical sessions
    └── global.json          # Global default session
```

#### Session Model
```typescript
interface Session {
  sessionId: string;        // Primary session identifier
  runId: string;           // Current run_id for frames
  projectId: string;       // Associated project
  branch?: string;         // Git branch if applicable
  startedAt: number;       // Session start timestamp
  lastActiveAt: number;    // Last activity timestamp
  metadata: {
    user?: string;
    environment?: string;
    tags?: string[];
  };
  state: 'active' | 'suspended' | 'closed';
}
```

### 2. Session Lifecycle Management

#### Auto-Recovery Strategy
```typescript
class SessionManager {
  // Session discovery priority:
  // 1. Explicit --session-id flag
  // 2. Environment variable STACKMEMORY_SESSION
  // 3. Current project + branch combination
  // 4. Last active session for project
  // 5. Create new session
  
  async getOrCreateSession(options?: SessionOptions): Promise<Session> {
    // Check explicit session
    if (options?.sessionId) {
      return this.loadSession(options.sessionId);
    }
    
    // Check environment
    if (process.env.STACKMEMORY_SESSION) {
      return this.loadSession(process.env.STACKMEMORY_SESSION);
    }
    
    // Check project context
    const projectHash = await this.getProjectHash();
    const branch = await this.getGitBranch();
    
    // Try project+branch session
    const branchSession = await this.findProjectBranchSession(projectHash, branch);
    if (branchSession && this.isSessionRecent(branchSession)) {
      return branchSession;
    }
    
    // Try last active for project
    const lastActive = await this.findLastActiveSession(projectHash);
    if (lastActive && this.isSessionRecent(lastActive)) {
      return lastActive;
    }
    
    // Create new session
    return this.createSession({ projectId: projectHash, branch });
  }
  
  private isSessionRecent(session: Session): boolean {
    const STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
    return Date.now() - session.lastActiveAt < STALE_THRESHOLD;
  }
}
```

### 3. Enhanced Frame Query Strategy

#### Multi-Mode Frame Visibility
```typescript
enum FrameQueryMode {
  CURRENT_SESSION = 'current',    // Current run_id only (default)
  PROJECT_ACTIVE = 'project',     // All active in project
  ALL_ACTIVE = 'all',            // All active across projects
  HISTORICAL = 'historical'        // Include closed frames
}

class FrameManager {
  async loadFrames(mode: FrameQueryMode = FrameQueryMode.CURRENT_SESSION): Promise<Frame[]> {
    switch(mode) {
      case FrameQueryMode.CURRENT_SESSION:
        return this.queryFrames({ runId: this.currentRunId, state: 'active' });
        
      case FrameQueryMode.PROJECT_ACTIVE:
        return this.queryFrames({ projectId: this.projectId, state: 'active' });
        
      case FrameQueryMode.ALL_ACTIVE:
        return this.queryFrames({ state: 'active' });
        
      case FrameQueryMode.HISTORICAL:
        return this.queryFrames({ includeInactive: true });
    }
  }
}
```

### 4. CLI Command Enhancements

#### New Commands
```bash
# Session management
stackmemory session list              # List all sessions
stackmemory session current           # Show current session
stackmemory session switch <id>       # Switch to session
stackmemory session suspend           # Suspend current
stackmemory session resume <id>       # Resume session
stackmemory session merge <id1> <id2> # Merge sessions

# Enhanced status with modes
stackmemory status                    # Current session (default)
stackmemory status --all             # All active frames
stackmemory status --project          # Project-wide frames
stackmemory status --session <id>    # Specific session
```

#### Updated Status Output
```
StackMemory Status:
  Session: abc123 (active, 2h old)
  Project: stackmemory
  Branch: main
  
  Current Session:
    Stack depth: 2
    Active frames: 2
    └─ StackMemory v0.3.0 Development [task]
       └─ Session Persistence Design [subtask]
  
  Other Active Sessions (same project):
    - def456: 1 frame (feature/linear-sync, 1d old)
    - ghi789: 3 frames (main, 3h old)
  
  Tip: Use --all to see frames across sessions
```

### 5. Implementation Plan

#### Phase 1: Session Persistence (Priority: HIGH)
1. Create SessionManager class
2. Implement session file storage
3. Add session discovery logic
4. Update FrameManager constructor

#### Phase 2: Enhanced Queries (Priority: HIGH)
1. Add FrameQueryMode enum
2. Implement multi-mode queries
3. Update status command
4. Add query mode flags

#### Phase 3: CLI Commands (Priority: MEDIUM)
1. Add session subcommands
2. Enhance status output
3. Add session switching
4. Implement merge capability

#### Phase 4: Auto-Recovery (Priority: HIGH)
1. Branch-aware sessions
2. Stale session detection
3. Automatic resumption
4. Session cleanup

### 6. Backward Compatibility

- Default behavior unchanged (new session per CLI call)
- Opt-in to persistence via:
  - `--persist` flag
  - `STACKMEMORY_PERSIST=true` environment variable
  - Config file setting
- Migration tool for existing frames

### 7. Configuration

```yaml
# ~/.stackmemory/config.yaml
sessions:
  persistence: enabled        # enabled|disabled|auto
  stale_threshold: 24h       # Session staleness
  auto_resume: true          # Resume on startup
  branch_isolation: false    # Separate sessions per branch
  cleanup_age: 30d          # Delete old sessions
  
display:
  default_query_mode: current  # current|project|all
  show_other_sessions: true    # Show in status
  compact_mode: false          # Condensed output
```

### 8. Database Schema Updates

```sql
-- Add session tracking
ALTER TABLE frames ADD COLUMN session_id TEXT;
CREATE INDEX idx_frames_session ON frames(session_id, state);

-- Session metadata table
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  branch TEXT,
  started_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  state TEXT DEFAULT 'active',
  metadata TEXT DEFAULT '{}',
  INDEX idx_sessions_project (project_id, state)
);

-- Session continuity
CREATE TABLE session_continuity (
  project_hash TEXT PRIMARY KEY,
  last_session_id TEXT,
  last_run_id TEXT,
  updated_at INTEGER
);
```

### 9. Testing Strategy

- Unit tests for SessionManager
- Integration tests for session recovery
- CLI command tests
- Multi-session query tests
- Branch switching tests
- Stale session handling tests

### 10. Migration Path

1. Deploy with opt-in flag
2. Monitor adoption and issues
3. Enable by default in next major version
4. Provide migration tool for existing data

## Benefits

1. **Continuity**: Work persists across CLI invocations
2. **Visibility**: See all active work, not just current session
3. **Recovery**: Automatically resume interrupted work
4. **Flexibility**: Choose visibility scope as needed
5. **Branch-Aware**: Separate contexts per Git branch
6. **Multi-User**: Support concurrent sessions

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Session conflicts | Use file locking and atomic operations |
| Stale sessions | Auto-cleanup and staleness detection |
| Performance impact | Index optimization and query caching |
| Breaking changes | Backward compatibility mode |
| Data corruption | Session validation and recovery |

## Timeline

- Week 1: Session persistence core
- Week 2: Enhanced queries and CLI
- Week 3: Auto-recovery and testing
- Week 4: Documentation and rollout