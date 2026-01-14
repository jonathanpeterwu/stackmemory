# Two-Tier Storage System

StackMemory implements an intelligent two-tier storage architecture that optimizes for performance, cost, and retention.

## Overview

The storage system automatically manages data lifecycle through multiple tiers:
- **Local Tiers**: Young → Mature → Old (with increasing compression)
- **Remote Storage**: Infinite retention with S3 + TimeSeries DB

## Local Storage Tiers

### Young Tier (<24 hours)
- **Compression**: None (fastest access)
- **Retention**: Complete data preservation
- **Storage**: Memory/Redis for hot cache
- **Use case**: Active development, current session data

### Mature Tier (1-7 days)
- **Compression**: LZ4 (~2.5x compression ratio)
- **Retention**: Selective (removes verbose logs, keeps important events)
- **Storage**: Local SQLite
- **Use case**: Recent work context, debugging history

### Old Tier (7-30 days)  
- **Compression**: ZSTD (~3.5x compression ratio)
- **Retention**: Critical data only (decisions, errors, key milestones)
- **Storage**: Local SQLite (compressed)
- **Use case**: Historical context, audit trail

## Remote Storage

### Archive Tier (>30 days)
- **Storage**: S3 Coldline + TimeSeries database
- **Retention**: Infinite (with monthly partitioning)
- **Compression**: ZSTD + S3 compression
- **Cost**: $0.004/GB/month
- **Use case**: Long-term history, compliance, analytics

## Migration Engine

### Automatic Triggers
- **Age-based**: Data older than tier thresholds
- **Size-based**: When local storage exceeds limits
- **Importance-based**: Low-importance data migrated earlier

### Migration Process
- Background worker runs every 60 seconds
- Processes in batches of 50 items
- Retries failed uploads with exponential backoff
- Maintains offline queue for network issues

### Importance Scoring
Frames are scored based on:
- **Decisions**: +10 points each
- **Errors**: +5 points each  
- **Tool calls**: +1 point each
- **Event count**: Bonus for activity
- **Manual anchors**: +15 points each

## Configuration

### CLI Commands

```bash
# Show storage status
stackmemory storage status

# View configuration
stackmemory storage config --show

# Trigger migration
stackmemory storage migrate --tier young

# Clean up old data
stackmemory storage cleanup --force

# Test storage system
stackmemory storage test --include-remote
```

### Configuration Options

```typescript
interface TwoTierConfig {
  local: {
    dbPath: string;
    maxSizeGB: number;
    tiers: TierConfig[];
  };
  remote: {
    redis?: RedisConfig;
    timeseries?: TimeSeriesConfig;
    s3: S3Config;
  };
  migration: {
    triggers: MigrationTrigger[];
    batchSize: number;
    intervalMs: number;
    offlineQueuePath: string;
  };
}
```

### Default Configuration

```javascript
const defaultConfig = {
  local: {
    maxSizeGB: 2,
    tiers: [
      {
        name: 'young',
        maxAgeHours: 24,
        compressionType: 'none',
        retentionPolicy: 'complete'
      },
      {
        name: 'mature', 
        maxAgeHours: 168, // 7 days
        compressionType: 'lz4',
        retentionPolicy: 'selective'
      },
      {
        name: 'old',
        maxAgeHours: 720, // 30 days
        compressionType: 'zstd',
        retentionPolicy: 'critical'
      }
    ]
  },
  migration: {
    triggers: [
      { type: 'age', threshold: 720, action: 'migrate' },
      { type: 'size', threshold: 2048, action: 'migrate' },
      { type: 'importance', threshold: 5, action: 'retain' }
    ],
    batchSize: 50,
    intervalMs: 60000
  }
};
```

## Performance Characteristics

### Storage Efficiency
- **Compression ratios**: LZ4 ~2.5x, ZSTD ~3.5x
- **Local capacity**: 2GB with automatic overflow handling
- **Migration throughput**: ~50 items per minute
- **Access patterns**: 90% of queries hit young tier

### Query Performance
- **Young tier**: <10ms (memory/Redis)
- **Mature tier**: <50ms (SQLite)
- **Old tier**: <100ms (compressed SQLite)
- **Remote tier**: 200-500ms (network dependent)

### Cost Optimization
- **Local storage**: ~$0/month (user's disk)
- **Hot cache**: ~$0.10/GB/month (Redis)
- **Remote storage**: ~$0.004/GB/month (S3 Coldline)
- **Transfer costs**: ~$0.09/GB for retrieval

## Monitoring

### Storage Metrics
```bash
stackmemory storage status
```

Output:
```
📊 Storage Tier Distribution
┌─────────┬───────┬──────────┬─────────────────┐
│ Tier    │ Items │ Size (MB)│ Description     │
├─────────┼───────┼──────────┼─────────────────┤
│ Young   │ 1,234 │ < 24h    │ Complete in RAM │
│ Mature  │ 5,678 │ 1-7 days │ LZ4 compressed  │
│ Old     │ 2,345 │ 7-30 days│ ZSTD compressed │
│ Remote  │ 50,000│ > 30 days│ S3 + TimeSeries │
└─────────┴───────┴──────────┴─────────────────┘

📈 Summary:
  Local Usage: 1.2 GB
  Compression Ratio: 2.8x  
  Pending Migrations: 45
  Last Migration: 2025-01-14T12:34:56Z
```

### Health Checks
- Migration queue depth
- Failed upload count
- Storage utilization
- Compression effectiveness
- Query performance metrics

## Best Practices

### Development
- Keep working data in young tier (automatic)
- Pin important decisions as anchors
- Use descriptive frame names for better retrieval
- Regular cleanup with `storage cleanup`

### Production
- Monitor storage utilization
- Set up alerts for failed migrations
- Configure S3 lifecycle policies
- Regular performance reviews

### Troubleshooting
```bash
# Check migration status
stackmemory storage status

# View failed uploads
stackmemory storage test --include-remote

# Force cleanup
stackmemory storage cleanup --force

# Reset offline queue
rm ~/.stackmemory/offline-queue.json
```

## Architecture

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────┐
│   Young Tier    │───▶│ Mature Tier  │───▶│  Old Tier   │
│   (<24h)        │    │  (1-7d)      │    │  (7-30d)    │
│ No compression  │    │ LZ4 compress │    │ZSTD compress│
│ Complete data   │    │ Selective    │    │ Critical    │
└─────────────────┘    └──────────────┘    └─────────────┘
         │                      │                   │
         └──────────────────────┼───────────────────┘
                                ▼
                    ┌─────────────────────┐
                    │   Remote Storage    │
                    │      (>30d)         │
                    │ S3 + TimeSeries DB  │
                    │ Infinite retention  │
                    └─────────────────────┘
```

## Implementation Details

### Database Schema
```sql
-- Storage items table
CREATE TABLE storage_items (
  id TEXT PRIMARY KEY,
  frame_id TEXT,
  tier TEXT NOT NULL,
  data_compressed BLOB,
  compression_type TEXT,
  created_at INTEGER,
  migrated_at INTEGER,
  importance_score INTEGER,
  size_bytes INTEGER
);

-- Migration queue
CREATE TABLE migration_queue (
  item_id TEXT PRIMARY KEY,
  target_tier TEXT,
  priority INTEGER,
  attempts INTEGER DEFAULT 0,
  last_attempt INTEGER,
  error_message TEXT
);
```

### API Integration
The storage system is automatically used by FrameManager:
```typescript
// Automatic tier selection
const storageId = await storage.storeFrame(frame, events, anchors);

// Retrieval with tier preference  
const data = await storage.retrieveFrame(frameId);

// Statistics
const stats = await storage.getStats();
```

---

*Two-tier storage system implemented in Phase 4 (STA-414) - v0.3.15*