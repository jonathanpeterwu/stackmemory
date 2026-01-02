/**
 * Railway-Optimized 3-Tier Storage System
 * Tier 1: Redis (Hot) - Last 24 hours, instant access
 * Tier 2: Railway Buckets (Warm) - 1-30 days, S3-compatible
 * Tier 3: GCS (Cold) - 30+ days, cost-effective archive
 */

import { createClient, RedisClientType } from 'redis';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Storage } from '@google-cloud/storage';
import Database from 'better-sqlite3';
import { logger } from '../monitoring/logger.js';
import { Trace, CompressedTrace, ToolCall } from '../trace/types.js';
import { ConfigManager } from '../config/config-manager.js';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

export enum StorageTier {
  HOT = 'hot',       // Redis: < 24 hours
  WARM = 'warm',     // Railway Buckets: 1-30 days  
  COLD = 'cold'      // GCS: 30+ days
}

export interface RailwayStorageConfig {
  redis: {
    url: string;
    ttlSeconds: number;
    maxMemoryMb: number;
  };
  railwayBuckets: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
  };
  gcs: {
    bucketName: string;
    projectId: string;
    keyFilename?: string;
  };
  tiers: {
    hotHours: number;        // Hours to keep in Redis
    warmDays: number;        // Days to keep in Railway Buckets
    compressionScore: number; // Score threshold for early compression
  };
}

export const DEFAULT_RAILWAY_CONFIG: RailwayStorageConfig = {
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    ttlSeconds: 86400,  // 24 hours
    maxMemoryMb: 100,    // 100MB Redis limit
  },
  railwayBuckets: {
    endpoint: process.env.RAILWAY_BUCKET_ENDPOINT || 'https://buckets.railway.app',
    bucket: process.env.RAILWAY_BUCKET_NAME || 'stackmemory-warm',
    accessKeyId: process.env.RAILWAY_BUCKET_ACCESS_KEY || '',
    secretAccessKey: process.env.RAILWAY_BUCKET_SECRET_KEY || '',
    region: 'us-east-1',
  },
  gcs: {
    bucketName: process.env.GCS_BUCKET || 'stackmemory-cold',
    projectId: process.env.GCP_PROJECT_ID || 'stackmemory',
    keyFilename: process.env.GCP_KEY_FILE,
  },
  tiers: {
    hotHours: 24,
    warmDays: 30,
    compressionScore: 0.4,
  }
};

interface StorageMetrics {
  tier: StorageTier;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  accessCount: number;
  lastAccessed: number;
  migrationTime?: number;
}

/**
 * Railway-optimized storage manager with 3-tier architecture
 */
export class RailwayOptimizedStorage {
  private redisClient?: RedisClientType;
  private railwayS3?: S3Client;
  private gcsStorage?: Storage;
  private localDb: Database.Database;
  private config: RailwayStorageConfig;
  private configManager: ConfigManager;
  private metricsCache: Map<string, StorageMetrics> = new Map();
  
  private initialized: Promise<void>;
  
  constructor(
    localDb: Database.Database,
    configManager: ConfigManager,
    config?: Partial<RailwayStorageConfig>
  ) {
    this.localDb = localDb;
    this.configManager = configManager;
    this.config = { ...DEFAULT_RAILWAY_CONFIG, ...config };
    
    this.initializeSchema();
    this.initialized = this.initializeClients();
  }
  
  /**
   * Initialize storage clients
   */
  private async initializeClients(): Promise<void> {
    // Initialize Redis
    if (this.config.redis.url) {
      try {
        this.redisClient = createClient({ url: this.config.redis.url });
        
        this.redisClient.on('error', (err) => {
          logger.error('Redis client error', err);
        });
        
        await this.redisClient.connect();
        
        // Configure Redis memory policy
        await this.redisClient.configSet('maxmemory-policy', 'allkeys-lru');
        
        logger.info('Redis connected for hot tier storage');
      } catch (error) {
        logger.warn('Redis connection failed, falling back to SQLite only', error);
      }
    }
    
    // Initialize Railway S3-compatible buckets
    if (this.config.railwayBuckets.accessKeyId) {
      this.railwayS3 = new S3Client({
        endpoint: this.config.railwayBuckets.endpoint,
        region: this.config.railwayBuckets.region,
        credentials: {
          accessKeyId: this.config.railwayBuckets.accessKeyId,
          secretAccessKey: this.config.railwayBuckets.secretAccessKey,
        },
        forcePathStyle: true, // Required for Railway buckets
      });
      
      logger.info('Railway Buckets configured for warm tier');
    }
    
    // Initialize GCS for cold storage
    if (this.config.gcs.projectId) {
      try {
        this.gcsStorage = new Storage({
          projectId: this.config.gcs.projectId,
          keyFilename: this.config.gcs.keyFilename,
        });
        
        logger.info('GCS configured for cold tier storage');
      } catch (error) {
        logger.warn('GCS setup failed, will use Railway buckets only', error);
      }
    }
  }
  
  /**
   * Initialize database schema for tracking
   */
  private initializeSchema(): void {
    this.localDb.exec(`
      CREATE TABLE IF NOT EXISTS storage_tiers (
        trace_id TEXT PRIMARY KEY,
        tier TEXT NOT NULL,
        location TEXT NOT NULL,
        original_size INTEGER,
        compressed_size INTEGER,
        compression_ratio REAL,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER,
        created_at INTEGER,
        migrated_at INTEGER,
        score REAL,
        FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
      )
    `);
    
    this.localDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_storage_tier ON storage_tiers(tier);
      CREATE INDEX IF NOT EXISTS idx_storage_created ON storage_tiers(created_at);
      CREATE INDEX IF NOT EXISTS idx_storage_accessed ON storage_tiers(last_accessed);
    `);
  }
  
  /**
   * Store a trace in the appropriate tier
   */
  async storeTrace(trace: Trace): Promise<StorageTier> {
    // Ensure clients are initialized
    await this.initialized;
    
    const score = trace.score;
    const age = Date.now() - trace.metadata.startTime;
    const ageHours = age / (1000 * 60 * 60);
    
    // Determine tier based on age and score
    let tier: StorageTier;
    if (ageHours < this.config.tiers.hotHours && score > this.config.tiers.compressionScore) {
      tier = StorageTier.HOT;
    } else if (ageHours < this.config.tiers.warmDays * 24) {
      tier = StorageTier.WARM;
    } else {
      tier = StorageTier.COLD;
    }
    
    // Store in appropriate tier
    switch (tier) {
      case StorageTier.HOT:
        await this.storeInRedis(trace);
        break;
      case StorageTier.WARM:
        await this.storeInRailwayBuckets(trace);
        break;
      case StorageTier.COLD:
        await this.storeInGCS(trace);
        break;
    }
    
    // Track in database
    this.trackStorage(trace.id, tier, trace);
    
    return tier;
  }
  
  /**
   * Store trace in Redis (hot tier)
   */
  private async storeInRedis(trace: Trace): Promise<void> {
    if (!this.redisClient) {
      // Fallback to local SQLite if Redis unavailable
      return;
    }
    
    try {
      const key = `trace:${trace.id}`;
      const data = JSON.stringify(trace);
      
      // Compress if large
      let storedData: string;
      if (data.length > 10000) {
        const compressed = await gzipAsync(data);
        storedData = compressed.toString('base64');
        await this.redisClient.hSet(key, {
          data: storedData,
          compressed: 'true',
          score: trace.score.toString(),
          type: trace.type,
          timestamp: trace.metadata.startTime.toString(),
        });
      } else {
        storedData = data;
        await this.redisClient.hSet(key, {
          data: storedData,
          compressed: 'false',
          score: trace.score.toString(),
          type: trace.type,
          timestamp: trace.metadata.startTime.toString(),
        });
      }
      
      // Set TTL
      await this.redisClient.expire(key, this.config.redis.ttlSeconds);
      
      // Add to sorted set for efficient retrieval
      await this.redisClient.zAdd('traces:by_score', {
        score: trace.score,
        value: trace.id,
      });
      
      await this.redisClient.zAdd('traces:by_time', {
        score: trace.metadata.startTime,
        value: trace.id,
      });
      
      logger.debug('Stored trace in Redis', { 
        traceId: trace.id, 
        size: data.length,
        compressed: data.length > 10000,
      });
      
    } catch (error) {
      logger.error('Failed to store in Redis', error);
      throw error;
    }
  }
  
  /**
   * Store trace in Railway Buckets (warm tier)
   */
  private async storeInRailwayBuckets(trace: Trace): Promise<void> {
    if (!this.railwayS3) {
      throw new Error('Railway Buckets not configured');
    }
    
    try {
      // Compress trace
      const data = JSON.stringify(trace);
      const compressed = await gzipAsync(data);
      
      // Generate key with date partitioning
      const date = new Date(trace.metadata.startTime);
      const key = `traces/${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${trace.id}.json.gz`;
      
      // Upload to Railway Bucket
      const command = new PutObjectCommand({
        Bucket: this.config.railwayBuckets.bucket,
        Key: key,
        Body: compressed,
        ContentType: 'application/gzip',
        Metadata: {
          'trace-id': trace.id,
          'trace-type': trace.type,
          'trace-score': trace.score.toString(),
          'original-size': data.length.toString(),
          'compressed-size': compressed.length.toString(),
        },
      });
      
      await this.railwayS3.send(command);
      
      // Remove from Redis if exists
      if (this.redisClient) {
        await this.redisClient.del(`trace:${trace.id}`);
      }
      
      logger.info('Stored trace in Railway Buckets', {
        traceId: trace.id,
        key,
        originalSize: data.length,
        compressedSize: compressed.length,
        compressionRatio: (1 - compressed.length / data.length).toFixed(2),
      });
      
    } catch (error) {
      logger.error('Failed to store in Railway Buckets', error);
      throw error;
    }
  }
  
  /**
   * Store trace in GCS (cold tier)
   */
  private async storeInGCS(trace: Trace): Promise<void> {
    if (!this.gcsStorage) {
      // Fallback to Railway Buckets if GCS not available
      return this.storeInRailwayBuckets(trace);
    }
    
    try {
      // Heavy compression for cold storage
      const minimal = this.createMinimalTrace(trace);
      const data = JSON.stringify(minimal);
      const compressed = await gzipAsync(data);
      
      // Generate key with year/month partitioning
      const date = new Date(trace.metadata.startTime);
      const key = `archive/${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${trace.id}.json.gz`;
      
      // Upload to GCS with Coldline storage class
      const bucket = this.gcsStorage.bucket(this.config.gcs.bucketName);
      const file = bucket.file(key);
      
      await file.save(compressed, {
        metadata: {
          contentType: 'application/gzip',
          metadata: {
            traceId: trace.id,
            traceType: trace.type,
            score: trace.score.toString(),
            originalTools: trace.tools.length.toString(),
          },
        },
        storageClass: 'COLDLINE', // Use Coldline for cost optimization
      });
      
      // Remove from warm tier if exists
      if (this.railwayS3) {
        try {
          const warmKey = this.getWarmTierKey(trace);
          await this.railwayS3.send(new DeleteObjectCommand({
            Bucket: this.config.railwayBuckets.bucket,
            Key: warmKey,
          }));
        } catch (error) {
          // Ignore deletion errors
        }
      }
      
      logger.info('Archived trace to GCS', {
        traceId: trace.id,
        key,
        originalSize: JSON.stringify(trace).length,
        compressedSize: compressed.length,
      });
      
    } catch (error) {
      logger.error('Failed to store in GCS', error);
      throw error;
    }
  }
  
  /**
   * Create minimal trace for cold storage
   */
  private createMinimalTrace(trace: Trace): any {
    // Keep only essential information
    return {
      id: trace.id,
      type: trace.type,
      score: trace.score,
      summary: trace.summary,
      metadata: {
        startTime: trace.metadata.startTime,
        endTime: trace.metadata.endTime,
        filesModified: trace.metadata.filesModified.length,
        errorsCount: trace.metadata.errorsEncountered.length,
        decisionsCount: trace.metadata.decisionsRecorded.length,
        causalChain: trace.metadata.causalChain,
      },
      toolSummary: {
        count: trace.tools.length,
        types: [...new Set(trace.tools.map(t => t.tool))],
        firstTool: trace.tools[0]?.tool,
        lastTool: trace.tools[trace.tools.length - 1]?.tool,
      },
      compressed: trace.compressed,
    };
  }
  
  /**
   * Retrieve a trace from any tier
   */
  async retrieveTrace(traceId: string): Promise<Trace | null> {
    // Ensure clients are initialized
    await this.initialized;
    
    // Check tier location
    const location = this.localDb.prepare(
      'SELECT tier, location FROM storage_tiers WHERE trace_id = ?'
    ).get(traceId) as any;
    
    if (!location) {
      return null;
    }
    
    // Update access metrics
    this.localDb.prepare(
      'UPDATE storage_tiers SET access_count = access_count + 1, last_accessed = ? WHERE trace_id = ?'
    ).run(Date.now(), traceId);
    
    // Retrieve based on tier
    switch (location.tier) {
      case StorageTier.HOT:
        return this.retrieveFromRedis(traceId);
      case StorageTier.WARM:
        return this.retrieveFromRailwayBuckets(traceId, location.location);
      case StorageTier.COLD:
        return this.retrieveFromGCS(traceId, location.location);
      default:
        return null;
    }
  }
  
  /**
   * Retrieve from Redis
   */
  private async retrieveFromRedis(traceId: string): Promise<Trace | null> {
    if (!this.redisClient) return null;
    
    try {
      const key = `trace:${traceId}`;
      const data = await this.redisClient.hGetAll(key);
      
      if (!data || !data.data) return null;
      
      let traceData: string;
      if (data.compressed === 'true') {
        const compressed = Buffer.from(data.data, 'base64');
        const decompressed = await gunzipAsync(compressed);
        traceData = decompressed.toString();
      } else {
        traceData = data.data;
      }
      
      return JSON.parse(traceData);
      
    } catch (error) {
      logger.error('Failed to retrieve from Redis', error);
      return null;
    }
  }
  
  /**
   * Retrieve from Railway Buckets
   */
  private async retrieveFromRailwayBuckets(traceId: string, key: string): Promise<Trace | null> {
    if (!this.railwayS3) return null;
    
    try {
      const command = new GetObjectCommand({
        Bucket: this.config.railwayBuckets.bucket,
        Key: key,
      });
      
      const response = await this.railwayS3.send(command);
      const compressed = await response.Body?.transformToByteArray();
      
      if (!compressed) return null;
      
      const decompressed = await gunzipAsync(Buffer.from(compressed));
      return JSON.parse(decompressed.toString());
      
    } catch (error) {
      logger.error('Failed to retrieve from Railway Buckets', error);
      return null;
    }
  }
  
  /**
   * Retrieve from GCS
   */
  private async retrieveFromGCS(traceId: string, key: string): Promise<Trace | null> {
    if (!this.gcsStorage) return null;
    
    try {
      const bucket = this.gcsStorage.bucket(this.config.gcs.bucketName);
      const file = bucket.file(key);
      
      const [compressed] = await file.download();
      const decompressed = await gunzipAsync(compressed);
      
      // Note: Returns minimal trace from cold storage
      return JSON.parse(decompressed.toString());
      
    } catch (error) {
      logger.error('Failed to retrieve from GCS', error);
      return null;
    }
  }
  
  /**
   * Track storage in database
   */
  private trackStorage(traceId: string, tier: StorageTier, trace: Trace): void {
    const originalSize = JSON.stringify(trace).length;
    const compressedSize = Math.floor(originalSize * 0.3); // Estimate
    
    this.localDb.prepare(`
      INSERT OR REPLACE INTO storage_tiers (
        trace_id, tier, location, original_size, compressed_size,
        compression_ratio, access_count, last_accessed, created_at,
        migrated_at, score
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(
      traceId,
      tier,
      this.getStorageLocation(trace, tier),
      originalSize,
      compressedSize,
      1 - compressedSize / originalSize,
      Date.now(),
      trace.metadata.startTime,
      Date.now(),
      trace.score
    );
  }
  
  /**
   * Get storage location key
   */
  private getStorageLocation(trace: Trace, tier: StorageTier): string {
    const date = new Date(trace.metadata.startTime);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    switch (tier) {
      case StorageTier.HOT:
        return `redis:trace:${trace.id}`;
      case StorageTier.WARM:
        return `traces/${year}/${month}/${day}/${trace.id}.json.gz`;
      case StorageTier.COLD:
        return `archive/${year}/${month}/${trace.id}.json.gz`;
    }
  }
  
  /**
   * Get warm tier key for a trace
   */
  private getWarmTierKey(trace: Trace): string {
    const date = new Date(trace.metadata.startTime);
    return `traces/${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${trace.id}.json.gz`;
  }
  
  /**
   * Migrate traces between tiers based on age
   */
  async migrateTiers(): Promise<{
    hotToWarm: number;
    warmToCold: number;
    errors: string[];
  }> {
    const results = {
      hotToWarm: 0,
      warmToCold: 0,
      errors: [] as string[],
    };
    
    const now = Date.now();
    
    // Find traces to migrate
    const candidates = this.localDb.prepare(`
      SELECT trace_id, tier, created_at, score
      FROM storage_tiers
      WHERE tier != 'cold'
      ORDER BY created_at ASC
    `).all() as any[];
    
    for (const candidate of candidates) {
      const ageHours = (now - candidate.created_at) / (1000 * 60 * 60);
      
      try {
        if (candidate.tier === StorageTier.HOT && ageHours > this.config.tiers.hotHours) {
          // Migrate hot → warm
          const trace = await this.retrieveTrace(candidate.trace_id);
          if (trace) {
            await this.storeInRailwayBuckets(trace);
            this.trackStorage(candidate.trace_id, StorageTier.WARM, trace);
            results.hotToWarm++;
          }
        } else if (candidate.tier === StorageTier.WARM && ageHours > this.config.tiers.warmDays * 24) {
          // Migrate warm → cold
          const trace = await this.retrieveTrace(candidate.trace_id);
          if (trace) {
            await this.storeInGCS(trace);
            this.trackStorage(candidate.trace_id, StorageTier.COLD, trace);
            results.warmToCold++;
          }
        }
      } catch (error) {
        results.errors.push(`Failed to migrate ${candidate.trace_id}: ${error}`);
      }
    }
    
    logger.info('Tier migration completed', results);
    return results;
  }
  
  /**
   * Get storage statistics
   */
  getStorageStats(): any {
    const tierStats = this.localDb.prepare(`
      SELECT 
        tier,
        COUNT(*) as count,
        SUM(original_size) as total_original,
        SUM(compressed_size) as total_compressed,
        AVG(compression_ratio) as avg_compression,
        AVG(access_count) as avg_access
      FROM storage_tiers
      GROUP BY tier
    `).all();
    
    const ageDistribution = this.localDb.prepare(`
      SELECT 
        CASE 
          WHEN (? - created_at) / 3600000 < 24 THEN '< 24h'
          WHEN (? - created_at) / 86400000 < 7 THEN '1-7d'
          WHEN (? - created_at) / 86400000 < 30 THEN '7-30d'
          ELSE '30d+'
        END as age_group,
        COUNT(*) as count
      FROM storage_tiers
      GROUP BY age_group
    `).all(Date.now(), Date.now(), Date.now());
    
    return {
      byTier: tierStats,
      byAge: ageDistribution,
      totalTraces: tierStats.reduce((sum: number, t: any) => sum + t.count, 0),
      totalSize: tierStats.reduce((sum: number, t: any) => sum + t.total_original, 0),
      compressedSize: tierStats.reduce((sum: number, t: any) => sum + t.total_compressed, 0),
    };
  }
  
  /**
   * Clean up expired data
   */
  async cleanup(): Promise<number> {
    let cleaned = 0;
    
    // Remove old entries from storage_tiers table
    const cutoff = Date.now() - (90 * 24 * 60 * 60 * 1000); // 90 days
    
    const result = this.localDb.prepare(`
      DELETE FROM storage_tiers
      WHERE tier = 'cold' AND created_at < ? AND access_count = 0
    `).run(cutoff);
    
    cleaned = result.changes;
    
    logger.info('Cleanup completed', { removed: cleaned });
    return cleaned;
  }
}