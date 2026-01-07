# Railway Storage Architecture

## Overview

StackMemory includes a 3-tier storage system optimized for Railway.app deployment, providing cost-effective and performant storage across different time horizons.

## Storage Tiers

### Tier 1: Hot Storage (Redis)
- **Duration**: Last 24 hours
- **Technology**: Redis with LRU eviction
- **Access Time**: <10ms
- **Use Case**: Active frames and recent context
- **Size Limit**: 100MB default

### Tier 2: Warm Storage (Railway Buckets)
- **Duration**: 1-30 days
- **Technology**: Railway Buckets (S3-compatible)
- **Access Time**: <100ms
- **Use Case**: Recent project history
- **Compression**: LZ4 compression applied

### Tier 3: Cold Storage (Google Cloud Storage)
- **Duration**: 30+ days
- **Technology**: GCS Coldline
- **Access Time**: <1s
- **Use Case**: Long-term archive
- **Cost**: $0.004/GB/month

## Configuration

### Environment Variables

```bash
# Redis Configuration (Tier 1)
REDIS_URL=redis://default:password@redis.railway.internal:6379
REDIS_MAX_MEMORY_MB=100

# Railway Buckets (Tier 2)
RAILWAY_BUCKET_ENDPOINT=https://buckets.railway.app
RAILWAY_BUCKET_NAME=stackmemory-warm
RAILWAY_BUCKET_ACCESS_KEY=your_access_key
RAILWAY_BUCKET_SECRET_KEY=your_secret_key

# Google Cloud Storage (Tier 3)
GCS_BUCKET=stackmemory-cold
GCP_PROJECT_ID=your-project-id
GCP_KEY_FILE=/path/to/service-account.json
```

### Configuration File

`.stackmemory/storage-config.json`:

```json
{
  "tiers": {
    "hotHours": 24,
    "warmDays": 30,
    "compressionScore": 0.4
  },
  "redis": {
    "ttlSeconds": 86400,
    "maxMemoryMb": 100
  },
  "migration": {
    "batchSize": 100,
    "intervalMinutes": 60
  }
}
```

## Code Examples

### Initialize Storage

```typescript
import { RailwayOptimizedStorage } from '@stackmemoryai/stackmemory';

const storage = new RailwayOptimizedStorage({
  redis: {
    url: process.env.REDIS_URL,
    ttlSeconds: 86400,
    maxMemoryMb: 100
  },
  railwayBuckets: {
    endpoint: process.env.RAILWAY_BUCKET_ENDPOINT,
    bucket: process.env.RAILWAY_BUCKET_NAME,
    accessKeyId: process.env.RAILWAY_BUCKET_ACCESS_KEY,
    secretAccessKey: process.env.RAILWAY_BUCKET_SECRET_KEY,
    region: 'us-east-1'
  },
  gcs: {
    bucketName: process.env.GCS_BUCKET,
    projectId: process.env.GCP_PROJECT_ID
  }
});

await storage.initialize();
```

### Store and Retrieve Data

```typescript
// Store a trace
await storage.storeTrace({
  id: 'trace-123',
  sessionId: 'session-456',
  score: 0.8,
  toolCalls: [...],
  timestamp: Date.now()
});

// Retrieve a trace (automatically checks all tiers)
const trace = await storage.getTrace('trace-123');

// Force retrieve from specific tier
const warmTrace = await storage.getFromTier('trace-123', StorageTier.WARM);
```

### Manual Migration

```typescript
// Migrate specific traces between tiers
await storage.migrateToWarm(['trace-1', 'trace-2', 'trace-3']);

// Migrate old data to cold storage
await storage.migrateToCold({
  olderThanDays: 30,
  batchSize: 100
});

// Check storage metrics
const metrics = await storage.getStorageMetrics();
console.log(`Hot: ${metrics.hot.size}MB, Warm: ${metrics.warm.size}GB`);
```

## Automatic Migration

The system automatically migrates data between tiers based on age and access patterns:

```typescript
// Migration rules (automatic)
const migrationRules = {
  hotToWarm: {
    trigger: 'age > 24 hours OR memory > 80%',
    action: 'move to Railway Buckets with LZ4 compression'
  },
  warmToCold: {
    trigger: 'age > 30 days AND score < 0.5',
    action: 'move to GCS Coldline with ZSTD compression'
  },
  promotions: {
    trigger: 'accessed > 3 times in 1 hour',
    action: 'promote to higher tier'
  }
};
```

## Performance Characteristics

### Write Performance
```typescript
// Parallel writes to hot tier with async warm backup
await Promise.all([
  storage.writeToHot(data),      // ~5ms
  storage.asyncBackupToWarm(data) // Non-blocking
]);
```

### Read Performance
```typescript
// Tiered read with fallback
const data = await storage.read(id);
// Attempts in order:
// 1. Redis (5-10ms)
// 2. Railway Buckets (50-100ms)  
// 3. GCS (500-1000ms)
```

### Batch Operations

```typescript
// Batch retrieve with tier hints
const traces = await storage.batchGet({
  ids: ['trace-1', 'trace-2', 'trace-3'],
  tierHint: StorageTier.WARM,
  parallel: true
});

// Batch migration
await storage.batchMigrate({
  fromTier: StorageTier.HOT,
  toTier: StorageTier.WARM,
  filter: trace => trace.score < 0.5,
  batchSize: 100
});
```

## Monitoring

### CLI Commands

```bash
# Check storage status
stackmemory storage:status

# Manual migration
stackmemory storage:migrate --from hot --to warm --older-than 24h

# Cleanup old data
stackmemory storage:cleanup --tier cold --older-than 365d
```

### Metrics Dashboard

```typescript
// Get real-time metrics
const dashboard = await storage.getDashboard();

console.log({
  hotTier: {
    size: dashboard.hot.sizeGB,
    items: dashboard.hot.count,
    hitRate: dashboard.hot.hitRate
  },
  warmTier: {
    size: dashboard.warm.sizeGB,
    items: dashboard.warm.count,
    compressionRatio: dashboard.warm.avgCompression
  },
  coldTier: {
    size: dashboard.cold.sizeGB,
    items: dashboard.cold.count,
    monthlyCost: dashboard.cold.costUSD
  }
});
```

## Cost Optimization

### Storage Costs (Monthly)
- **Redis**: $0.10/GB (Railway)
- **Railway Buckets**: $0.02/GB
- **GCS Coldline**: $0.004/GB

### Example: 10GB Project
```
Hot (1GB):  $0.10
Warm (5GB): $0.10  
Cold (4GB): $0.016
Total: ~$0.22/month
```

### Optimization Tips

1. **Adjust TTLs**: Reduce Redis TTL for lower-score frames
2. **Aggressive Compression**: Enable for score < 0.4
3. **Batch Migrations**: Run during off-peak hours
4. **Cleanup Policy**: Delete cold data > 1 year

## Deployment on Railway

### Railway.app Configuration

1. **Add Redis Service**:
   ```bash
   railway add redis
   ```

2. **Configure Buckets**:
   ```bash
   railway buckets create stackmemory-warm
   ```

3. **Set Environment Variables**:
   ```bash
   railway vars set REDIS_URL=$REDIS_URL
   railway vars set RAILWAY_BUCKET_NAME=stackmemory-warm
   ```

4. **Deploy**:
   ```bash
   railway up
   ```

## Troubleshooting

### Common Issues

1. **Redis Memory Full**:
   ```bash
   # Force migration to warm tier
   stackmemory storage:migrate --force --from hot --to warm
   ```

2. **Slow Retrieval**:
   ```bash
   # Check tier distribution
   stackmemory storage:analyze --show-distribution
   ```

3. **High Costs**:
   ```bash
   # Optimize storage distribution
   stackmemory storage:optimize --target-cost 10
   ```