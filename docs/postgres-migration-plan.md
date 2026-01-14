# PostgreSQL Migration Plan for StackMemory (Production/Hosted Only)

## Executive Summary
Based on the "Postgres for Everything" philosophy and StackMemory's current architecture, migrating to PostgreSQL as the primary database **for production/hosted deployments only** can significantly simplify our infrastructure while maintaining or improving performance. Local CLI users will continue using SQLite.

## Current Architecture Analysis

### Databases & Storage Currently Used:
1. **SQLite** (Primary)
   - Frame management
   - Event storage
   - Anchor storage
   - Session management
   - Linear task caching

2. **Redis** (Hot Tier)
   - Session caching
   - Real-time metrics
   - Temporary storage (<1 hour)
   - Rate limiting

3. **ChromaDB** (Vector Storage)
   - Embeddings
   - Similarity search
   - Document storage

4. **S3** (Cold Storage)
   - Archive storage (>30 days)
   - Large file storage

## Migration Strategy

### Phase 1: Core Database Migration (Week 1-2)
**Replace SQLite with PostgreSQL**

Benefits:
- Better concurrent write performance
- Native JSONB support for complex data
- Built-in full-text search (replacing need for separate search)
- WAL for better durability
- Connection pooling

Implementation:
```sql
-- Frames table with JSONB for flexibility
CREATE TABLE frames (
  frame_id UUID PRIMARY KEY,
  project_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  metadata JSONB,
  inputs JSONB,
  outputs JSONB,
  digest_json JSONB,
  INDEX idx_project_created (project_id, created_at DESC)
);

-- Events with partitioning by date
CREATE TABLE events (
  event_id UUID PRIMARY KEY,
  frame_id UUID REFERENCES frames,
  event_type VARCHAR(50),
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY RANGE (created_at);
```

### Phase 2: Replace Redis with PostgreSQL (Week 3)
**Use PostgreSQL for caching and queuing**

Features to implement:
1. **Session Store**: Using UNLOGGED tables for performance
2. **Queue System**: Using SKIP LOCKED for job processing
3. **Rate Limiting**: Using window functions
4. **Pub/Sub**: Using NOTIFY/LISTEN

```sql
-- Session store (unlogged for speed)
CREATE UNLOGGED TABLE sessions (
  session_id VARCHAR(255) PRIMARY KEY,
  data JSONB,
  expires_at TIMESTAMPTZ,
  INDEX idx_expires (expires_at)
);

-- Job queue with SKIP LOCKED
CREATE TABLE job_queue (
  job_id UUID PRIMARY KEY,
  queue_name VARCHAR(50),
  payload JSONB,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  INDEX idx_queue_status (queue_name, status, created_at)
);
```

### Phase 3: Vector Search Integration (Week 4)
**Replace ChromaDB with pgvector**

```sql
-- Enable pgvector extension
CREATE EXTENSION vector;

-- Embeddings table
CREATE TABLE embeddings (
  id UUID PRIMARY KEY,
  frame_id UUID REFERENCES frames,
  content TEXT,
  embedding vector(1536),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create vector index for similarity search
CREATE INDEX idx_embedding_vector ON embeddings 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

### Phase 4: Advanced Features (Week 5)
**Leverage PostgreSQL extensions**

1. **TimescaleDB** for time-series data
2. **pg_cron** for scheduled tasks
3. **pg_stat_statements** for monitoring
4. **pg_trgm** for fuzzy text search

## Performance Considerations

### Pros:
- Single database reduces network hops
- MVCC provides excellent concurrent performance
- Connection pooling with PgBouncer
- Read replicas for scaling
- Partitioning for large tables

### Cons:
- Initial migration complexity
- Team needs PostgreSQL expertise
- Slightly higher latency than Redis for pure caching

## Cost Analysis

### Current Monthly Costs (Estimated):
- SQLite hosting: $0 (local)
- Redis: $50-200/month
- ChromaDB: $100-300/month
- Total: $150-500/month

### PostgreSQL Costs:
- Managed PostgreSQL (Railway/Supabase): $20-100/month
- Backup storage: $10/month
- Total: $30-110/month

**Potential Savings: $120-390/month (60-78% reduction)**

## Implementation Timeline

### Week 1-2: Core Migration
- [ ] Set up PostgreSQL instance
- [ ] Create migration scripts from SQLite
- [ ] Update database adapters
- [ ] Test frame management

### Week 3: Redis Replacement
- [ ] Implement session store
- [ ] Build job queue system
- [ ] Add rate limiting
- [ ] Remove Redis dependencies

### Week 4: Vector Search
- [ ] Install pgvector
- [ ] Migrate embeddings
- [ ] Update similarity search
- [ ] Performance testing

### Week 5: Polish & Optimization
- [ ] Add monitoring
- [ ] Set up backups
- [ ] Performance tuning
- [ ] Documentation

## Risk Mitigation

1. **Data Loss**: Implement dual-write during migration
2. **Performance**: Benchmark each component before switching
3. **Rollback Plan**: Keep old system running in parallel
4. **Team Knowledge**: PostgreSQL training/documentation

## Decision Recommendation

✅ **PROCEED WITH MIGRATION (PRODUCTION ONLY)**

Rationale for Hybrid Approach:
1. **Simplification**: Reduce from 4 storage systems to 1-2
2. **Cost Savings**: 60-78% reduction in infrastructure costs
3. **Developer Experience**: Single query language, unified monitoring
4. **Scalability**: PostgreSQL proven at Instagram/Discord scale
5. **Features**: Get search, vectors, queues, caching for free

## Next Steps

1. Create Linear task for PostgreSQL migration (STA-XXX)
2. Set up development PostgreSQL instance
3. Build proof-of-concept for Phase 1
4. Benchmark SQLite vs PostgreSQL performance
5. Create detailed migration scripts

## References
- [Just Use Postgres for Everything](https://www.amazingcto.com/postgres-for-everything/)
- [Redis vs SolidQueue](https://www.simplethread.com/redis-solidqueue/)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [PostgreSQL Performance Guide](https://www.postgresql.org/docs/current/performance-tips.html)