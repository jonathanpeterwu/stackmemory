# Storage Comparison for Short-Duration VM Instances

## Context
For short-duration VM instances (e.g., GitHub Actions, Railway deploys, ephemeral containers), choosing the right storage strategy is critical for StackMemory.

## Storage Options Comparison

### 1. SQLite (Current Implementation)
**Pros:**
- Zero network latency (local file)
- No external dependencies
- ACID compliant transactions
- Good for reads (very fast)
- Single file portability

**Cons:**
- Lost when VM terminates
- No built-in replication
- File size grows over time (~5-50MB typical)
- Requires disk I/O
- No concurrent write scaling

**Best for:** Development, testing, single-instance apps with <1000 frames

### 2. Git Storage (Files + Commits)
**Pros:**
- Automatic versioning
- Survives VM restarts (pushed to repo)
- Zero infrastructure cost
- Works with any Git provider
- Natural branching/merging

**Cons:**
- Slow for queries (file scanning)
- Not suitable for frequent writes
- Git history bloat
- No indexing/relationships
- Poor for structured queries

**Best for:** Configuration, skills, small datasets (<100 items)

### 3. Skills.md / JSON Files
**Pros:**
- Human readable
- Easy to edit manually
- Version control friendly
- No dependencies
- Fast to implement

**Cons:**
- No querying capability
- Full file must be parsed
- No concurrent access
- Limited to small datasets
- No relationships

**Best for:** Static configuration, learned patterns, skills definitions

### 4. Hosted Database (PostgreSQL/MySQL)
**Pros:**
- Data persists across deployments
- Professional grade performance
- Concurrent access
- Advanced queries
- Proper indexing

**Cons:**
- Network latency (5-50ms per query)
- Requires connection management
- External dependency
- Cost ($5-50/month)
- Connection limits on free tiers

**Best for:** Production apps, multi-instance, >1000 frames

## Recommendations by Use Case

### GitHub Actions / CI/CD (Duration: 5-60 minutes)
**Recommended: Git Storage + JSON Files**
```yaml
Strategy:
  - Store skills in skills.json
  - Save frames as JSON in .stackmemory/frames/
  - Commit and push important state
  - Use git as persistence layer
```

### Railway / Vercel (Duration: Hours to Days)
**Recommended: Hosted PostgreSQL**
```yaml
Strategy:
  - Use Railway's PostgreSQL addon
  - Connection pooling with pg-pool
  - Implement caching layer (Redis)
  - Fallback to SQLite for local dev
```

### Docker Containers (Duration: Variable)
**Recommended: Hybrid Approach**
```yaml
Strategy:
  - SQLite for temporary data
  - Volume mount for persistence
  - Periodic export to JSON
  - S3/GCS for long-term storage
```

### Development Environment
**Recommended: SQLite**
```yaml
Strategy:
  - Simple setup
  - No external dependencies
  - Easy to reset/clear
  - Good enough performance
```

## Implementation Strategy for Short-Duration VMs

### Optimal Hybrid Architecture
```typescript
class HybridStorage {
  constructor() {
    // Priority order
    this.storage = [
      new MemoryCache(),      // L1: In-memory (fastest)
      new SQLiteStorage(),    // L2: Local disk
      new GitStorage(),       // L3: Persistent
      new HostedDB()         // L4: Fallback
    ];
  }
  
  async save(data: Frame) {
    // Write to memory and SQLite immediately
    await Promise.all([
      this.storage[0].save(data),
      this.storage[1].save(data)
    ]);
    
    // Async write to persistent storage
    setImmediate(() => {
      this.storage[2].save(data).catch(console.error);
    });
  }
  
  async load(id: string) {
    // Try each tier in order
    for (const store of this.storage) {
      try {
        const data = await store.load(id);
        if (data) return data;
      } catch (e) {
        continue;
      }
    }
    return null;
  }
}
```

### Size Considerations

| Storage Type | Typical Size | 1000 Frames | 10000 Frames |
|-------------|--------------|-------------|--------------|
| SQLite      | 5-50MB       | ~5MB        | ~50MB        |
| JSON Files  | 2-20MB       | ~2MB        | ~20MB        |
| Git Repo    | 10-100MB     | ~10MB       | ~100MB       |
| PostgreSQL  | N/A (remote) | ~3MB        | ~30MB        |

### Performance Metrics

| Operation | SQLite | JSON | Git | PostgreSQL |
|-----------|--------|------|-----|------------|
| Write     | 5ms    | 10ms | 100ms | 20ms     |
| Read      | 1ms    | 5ms  | 50ms  | 10ms     |
| Query     | 2ms    | N/A  | N/A   | 5ms      |
| Startup   | 10ms   | 1ms  | 100ms | 500ms    |

## Final Recommendation

For **short-duration VM instances**, use a **three-tier strategy**:

1. **Hot Data**: In-memory cache (last 100 frames)
2. **Warm Data**: JSON files in `.stackmemory/` directory
3. **Cold Data**: Git commits or external API

```typescript
// Optimized for short-duration VMs
const storage = process.env.VM_DURATION === 'short' 
  ? new GitBackedJSONStorage()  // Best for CI/CD
  : new SQLiteStorage();         // Best for local dev

// With automatic persistence
if (process.env.PERSIST_ON_EXIT) {
  process.on('SIGTERM', async () => {
    await storage.exportToGit();
    process.exit(0);
  });
}
```

This approach:
- Minimizes dependencies
- Works offline
- Survives VM termination
- Costs nothing
- Scales to ~10,000 frames
- Maintains query capability