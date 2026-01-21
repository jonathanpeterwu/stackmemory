# 3-Tier Data Handling System for StackMemory

## Overview
Implement intelligent data tier management that automatically moves frame data between local SQLite, hosted Redis cache, and hosted PostgreSQL based on usage patterns, age, and performance requirements.

## Architecture

### Tier 1: Local SQLite (Hot Data)
- **Purpose**: Active session data, recent frames (<24h), high-frequency access
- **Location**: `~/.stackmemory/frames.db`
- **Characteristics**: Immediate access, no network latency
- **Size Limit**: 500MB max
- **Retention**: Last 1000 frames or 24 hours

### Tier 2: Hosted Redis (Warm Cache)
- **Purpose**: Recent project data (1-7 days), cross-session sharing
- **Location**: Railway Redis instance or external Redis
- **Characteristics**: Fast network access, shared between machines
- **Size Limit**: 1GB total
- **Retention**: 7 days with LRU eviction
- **TTL**: 24 hours default, extended on access

### Tier 3: Hosted PostgreSQL (Cold Storage)
- **Purpose**: Long-term archival, analytics, full-text search
- **Location**: Railway Postgres or external instance
- **Characteristics**: Persistent, queryable, compressed
- **Size Limit**: Unlimited (cost-optimized)
- **Retention**: Indefinite with configurable policies

## Data Flow

```
New Frame → SQLite (Tier 1)
    ↓ (after 24h or 1000 frames)
Redis (Tier 2) ← Access Pattern Analysis
    ↓ (after 7 days or size pressure)
PostgreSQL (Tier 3)
```

## Implementation Requirements

### Core Components

1. **TierManager Class** (`src/core/storage/tier-manager.ts`)
   - Orchestrates data movement between tiers
   - Implements eviction policies
   - Handles tier failure scenarios
   - Provides unified query interface

2. **RedisAdapter Class** (`src/core/storage/redis-adapter.ts`)
   - Redis connection management with reconnection logic
   - Data serialization/deserialization
   - TTL management and renewal
   - Batch operations for efficiency

3. **PostgresAdapter Class** (`src/core/storage/postgres-adapter.ts`)
   - Connection pooling and prepared statements
   - Schema migration management
   - Full-text search capabilities
   - Compression for large frame data

4. **TierConfiguration** (`src/core/config/tier-config.ts`)
   - Environment-based tier selection
   - Connection string management
   - Policy configuration (TTL, size limits, retention)

### Database Schemas

#### SQLite (Existing + Extensions)
```sql
-- Extend existing frames table
ALTER TABLE frames ADD COLUMN tier_status TEXT DEFAULT 'hot';
ALTER TABLE frames ADD COLUMN last_accessed INTEGER;
ALTER TABLE frames ADD COLUMN access_count INTEGER DEFAULT 1;

-- New tier tracking table
CREATE TABLE tier_metadata (
  frame_id TEXT PRIMARY KEY,
  tier_level INTEGER, -- 1=SQLite, 2=Redis, 3=Postgres
  promoted_at INTEGER,
  access_pattern TEXT,
  size_bytes INTEGER
);
```

#### Redis Schema
```
Key Pattern: sm:frame:{frame_id}
Value: Compressed JSON frame data
TTL: 86400 seconds (24h), renewed on access
Metadata: sm:meta:{frame_id} -> {tier_level, accessed_at, access_count}
```

#### PostgreSQL Schema
```sql
CREATE TABLE frames_archive (
  frame_id UUID PRIMARY KEY,
  session_id UUID,
  project_id TEXT,
  frame_data JSONB,
  frame_data_compressed BYTEA,
  created_at TIMESTAMP,
  archived_at TIMESTAMP DEFAULT NOW(),
  last_accessed TIMESTAMP,
  access_count INTEGER DEFAULT 0,
  size_bytes INTEGER,
  search_vector TSVECTOR
);

CREATE INDEX idx_frames_project ON frames_archive(project_id);
CREATE INDEX idx_frames_session ON frames_archive(session_id);
CREATE INDEX idx_frames_search ON frames_archive USING GIN(search_vector);
CREATE INDEX idx_frames_created ON frames_archive(created_at);
```

### API Interface

#### New CLI Commands
```bash
stackmemory storage status              # Show tier distribution
stackmemory storage migrate --tier 2    # Force migration to Redis
stackmemory storage migrate --tier 3    # Force migration to Postgres
stackmemory storage retrieve <frame_id> # Get from any tier
stackmemory storage compact             # Run cleanup/compaction
stackmemory storage stats               # Performance statistics
```

#### Configuration
```typescript
interface TierConfig {
  enabled: boolean;
  tiers: {
    sqlite: {
      maxSize: number;        // 500MB
      maxFrames: number;      // 1000
      maxAge: number;         // 24h in seconds
    };
    redis: {
      enabled: boolean;
      connectionString: string;
      ttl: number;            // 7 days
      maxSize: number;        // 1GB
    };
    postgres: {
      enabled: boolean;
      connectionString: string;
      compressionLevel: number;
      retentionDays?: number; // Optional cleanup
    };
  };
  policies: {
    promotionThreshold: number;   // Access count to promote
    evictionStrategy: 'LRU' | 'LFU' | 'AGE';
    backgroundSync: boolean;
    syncInterval: number;         // seconds
  };
}
```

### Performance Requirements
- Local SQLite queries: <10ms
- Redis operations: <50ms
- PostgreSQL queries: <200ms
- Background tier migration: <5% CPU overhead
- Failed tier fallback: <100ms additional latency

### Integration Points

1. **Frame Manager Integration**
   - Modify `FrameManager` to use `TierManager` for all frame operations
   - Transparent tier selection based on frame age/access patterns
   - Automatic promotion of frequently accessed frames

2. **Context Bridge Integration**
   - Update context retrieval to search across all tiers
   - Implement intelligent pre-fetching for related frames
   - Background warming of likely-needed frames

3. **CLI Integration**
   - Add tier information to `stackmemory status`
   - Include storage metrics in monitoring commands
   - Configuration management through existing config system

4. **Error Handling**
   - Graceful degradation when Redis/Postgres unavailable
   - Automatic retry with exponential backoff
   - Local-only mode fallback

### Testing Strategy

1. **Unit Tests**
   - Each adapter with mocked connections
   - Tier promotion/demotion logic
   - Configuration validation

2. **Integration Tests**
   - End-to-end data flow testing
   - Failover scenarios (Redis down, Postgres down)
   - Performance benchmarks

3. **Load Tests**
   - High-frequency frame creation
   - Concurrent access patterns
   - Memory usage under pressure

## Success Criteria

1. **Functionality**
   - ✅ Transparent tier management (user doesn't know which tier)
   - ✅ Data never lost (even with tier failures)
   - ✅ Query performance within SLA limits
   - ✅ Background migration doesn't impact user experience

2. **Performance**
   - ✅ 90% of queries served from local SQLite
   - ✅ <100ms latency for cross-tier operations
   - ✅ Graceful handling of 10k+ frames

3. **Reliability**
   - ✅ Survives Redis/Postgres outages
   - ✅ No data corruption during tier migrations
   - ✅ Self-healing tier synchronization

## Implementation Phases

### Phase 1: Foundation (Week 1)
- TierManager and adapter interfaces
- Basic SQLite extension
- Configuration system
- Unit tests

### Phase 2: Redis Integration (Week 2)
- RedisAdapter implementation
- Tier 1 → Tier 2 migration
- CLI commands
- Integration tests

### Phase 3: PostgreSQL Integration (Week 3)
- PostgresAdapter implementation
- Full 3-tier workflow
- Search capabilities
- Performance optimization

### Phase 4: Production Ready (Week 4)
- Error handling and resilience
- Monitoring and metrics
- Documentation
- Load testing

## Files to Create/Modify

### New Files
- `src/core/storage/tier-manager.ts`
- `src/core/storage/redis-adapter.ts`
- `src/core/storage/postgres-adapter.ts`
- `src/core/config/tier-config.ts`
- `src/cli/commands/storage.ts`

### Modified Files
- `src/core/context/frame-manager.ts` (integrate TierManager)
- `src/core/context/context-bridge.ts` (cross-tier queries)
- `src/core/config/config-manager.ts` (tier configuration)
- `src/cli/index.ts` (add storage commands)
- `package.json` (add Redis + Postgres dependencies)

### Test Files
- `src/core/storage/__tests__/tier-manager.test.ts`
- `src/core/storage/__tests__/redis-adapter.test.ts`
- `src/core/storage/__tests__/postgres-adapter.test.ts`
- `tests/integration/tier-integration.test.ts`

## Dependencies to Add
```json
{
  "redis": "^4.6.0",
  "pg": "^8.11.0",
  "@types/pg": "^8.10.0",
  "compression": "^1.7.4",
  "uuid": "^9.0.0"
}
```

This feature represents a significant architectural enhancement that will improve StackMemory's scalability, performance, and multi-machine collaboration capabilities.