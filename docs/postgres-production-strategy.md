# PostgreSQL for Production Hosting Strategy

## Overview
PostgreSQL will be used **exclusively for hosted/production deployments**, while SQLite remains the default for local CLI usage.

## Deployment Strategy

### Local/CLI (Default)
- **Database**: SQLite
- **Use Case**: Individual developers, CLI tool
- **Benefits**: Zero configuration, works offline, embedded

### Production/Hosted
- **Database**: PostgreSQL  
- **Use Case**: Teams, cloud deployments, Railway/Vercel hosting
- **Benefits**: Concurrent users, real-time sync, scalability

## Implementation Approach

### 1. Dual Adapter Support
```typescript
// Existing adapter interface already supports this
const adapter = process.env.DATABASE_URL 
  ? new PostgreSQLAdapter(process.env.DATABASE_URL)
  : new SQLiteAdapter({ dbPath: '~/.stackmemory/db.sqlite' });
```

### 2. Production Features (PostgreSQL Only)
- Multi-user collaboration
- Real-time updates via LISTEN/NOTIFY
- Team workspaces
- Centralized Linear sync
- Vector search with pgvector
- Job queues for background processing
- Redis-like caching with UNLOGGED tables

### 3. Migration Path
```
Local Development → Team Trial → Production
     SQLite      →  PostgreSQL → PostgreSQL
   (single user)    (small team)  (scaled)
```

## Benefits of This Approach

1. **No Breaking Changes**: Existing CLI users unaffected
2. **Progressive Enhancement**: Teams get advanced features
3. **Lower Risk**: Test PostgreSQL with subset of users
4. **Cost Efficient**: Only pay for PostgreSQL when needed
5. **Best of Both Worlds**: Simple local, powerful cloud

## Rollout Plan

### Phase 1: Add PostgreSQL Adapter (Week 1)
- [ ] Create PostgreSQLAdapter class
- [ ] Implement database interface
- [ ] Add connection pooling
- [ ] Test with Railway

### Phase 2: Production Features (Week 2-3)
- [ ] Team workspaces
- [ ] Real-time sync
- [ ] Shared context across team
- [ ] Centralized Linear integration

### Phase 3: Migration Tools (Week 4)
- [ ] SQLite → PostgreSQL migration script
- [ ] Data export/import utilities
- [ ] Backup/restore tools

## Environment Detection

```typescript
export function getDatabaseAdapter(projectId: string): DatabaseAdapter {
  // Production environments
  if (process.env.DATABASE_URL || process.env.RAILWAY_ENVIRONMENT) {
    return new PostgreSQLAdapter(projectId, {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production'
    });
  }
  
  // Local development
  return new SQLiteAdapter(projectId, {
    dbPath: path.join(os.homedir(), '.stackmemory', 'stackmemory.db')
  });
}
```

## Linear Task Queue

- **Priority**: Medium (not urgent, but important for growth)
- **Timeline**: Q2 2025
- **Dependencies**: Complete STA-414 (Two-Tier Storage) first
- **Team**: Backend team focus

## Success Metrics

- Zero impact on existing CLI users
- <100ms latency for production queries  
- Support 100+ concurrent users
- 99.9% uptime for hosted version
- Successful migration of 10+ teams

## Next Steps

1. Complete STA-414 with current architecture
2. Create PostgreSQLAdapter as experimental feature
3. Test with internal team first
4. Gradual rollout to production users
5. Document migration path for teams