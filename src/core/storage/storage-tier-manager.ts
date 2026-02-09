/**
 * StorageTierManager - Cold-tier frame archival to S3/GCS
 * Archives old frames to cloud storage before GC deletion,
 * with rehydration cache for on-demand retrieval.
 */

import type { Frame } from '../context/index.js';

export interface ColdStorageProvider {
  upload(key: string, data: Buffer): Promise<void>;
  download(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export interface StorageTierConfig {
  coldTierProvider?: 'none' | 's3' | 'gcs';
  coldTierBucket?: string;
  coldTierPrefix?: string; // default: 'stackmemory/frames/'
  migrationAgeDays?: number; // frames older than this get migrated (default: 60)
  rehydrateCacheMinutes?: number; // cache rehydrated frames for N minutes (default: 30)
}

/**
 * In-memory implementation of ColdStorageProvider for testing.
 */
export class InMemoryColdStorageProvider implements ColdStorageProvider {
  private store = new Map<string, Buffer>();

  async upload(key: string, data: Buffer): Promise<void> {
    this.store.set(key, Buffer.from(data));
  }

  async download(key: string): Promise<Buffer | null> {
    const data = this.store.get(key);
    return data ? Buffer.from(data) : null;
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    return keys;
  }

  /** Test helper: get current store size */
  get size(): number {
    return this.store.size;
  }

  /** Test helper: clear all stored data */
  clear(): void {
    this.store.clear();
  }
}

export class StorageTierManager {
  private provider: ColdStorageProvider | null = null;
  private config: StorageTierConfig;
  private rehydrateCache = new Map<
    string,
    { frame: Frame; cachedAt: number }
  >();

  constructor(config: StorageTierConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    switch (this.config.coldTierProvider) {
      case 's3':
        this.provider = await this.createS3Provider();
        break;
      case 'gcs':
        this.provider = await this.createGCSProvider();
        break;
      default:
        this.provider = null;
    }
  }

  /**
   * Initialize with an externally-provided ColdStorageProvider.
   * Useful for testing or custom backends.
   */
  initializeWithProvider(provider: ColdStorageProvider): void {
    this.provider = provider;
  }

  get isEnabled(): boolean {
    return this.provider !== null;
  }

  /** Archive a frame to cold storage */
  async archiveFrame(frame: Frame): Promise<boolean> {
    if (!this.provider) return false;
    const key = this.frameKey(frame.frame_id);
    const data = Buffer.from(JSON.stringify(frame));
    await this.provider.upload(key, data);
    return true;
  }

  /** Archive multiple frames (batch) */
  async archiveFrames(frames: Frame[]): Promise<number> {
    let archived = 0;
    for (const frame of frames) {
      if (await this.archiveFrame(frame)) archived++;
    }
    return archived;
  }

  /** Rehydrate a frame from cold storage (with local cache) */
  async rehydrateFrame(frameId: string): Promise<Frame | null> {
    // Check cache first
    const cached = this.rehydrateCache.get(frameId);
    const cacheMs = (this.config.rehydrateCacheMinutes ?? 30) * 60 * 1000;
    if (cached && Date.now() - cached.cachedAt < cacheMs) {
      return cached.frame;
    }

    if (!this.provider) return null;
    const key = this.frameKey(frameId);
    const data = await this.provider.download(key);
    if (!data) return null;

    const frame = JSON.parse(data.toString()) as Frame;
    this.rehydrateCache.set(frameId, { frame, cachedAt: Date.now() });
    return frame;
  }

  /** Delete an archived frame from cold storage */
  async deleteArchived(frameId: string): Promise<boolean> {
    if (!this.provider) return false;
    const key = this.frameKey(frameId);
    const found = await this.provider.exists(key);
    if (!found) return false;
    await this.provider.delete(key);
    this.rehydrateCache.delete(frameId);
    return true;
  }

  /** Get storage stats */
  async getStats(): Promise<{
    provider: string;
    archivedFrames: number;
    bucket: string;
  }> {
    if (!this.provider) {
      return { provider: 'none', archivedFrames: 0, bucket: '' };
    }
    const prefix = this.config.coldTierPrefix ?? 'stackmemory/frames/';
    const keys = await this.provider.list(prefix);
    return {
      provider: this.config.coldTierProvider ?? 'none',
      archivedFrames: keys.length,
      bucket: this.config.coldTierBucket ?? '',
    };
  }

  /** Clear the rehydration cache */
  clearCache(): void {
    this.rehydrateCache.clear();
  }

  private frameKey(frameId: string): string {
    const prefix = this.config.coldTierPrefix ?? 'stackmemory/frames/';
    return `${prefix}${frameId}.json`;
  }

  private async createS3Provider(): Promise<ColdStorageProvider> {
    const {
      S3Client,
      PutObjectCommand,
      GetObjectCommand,
      HeadObjectCommand,
      DeleteObjectCommand,
      ListObjectsV2Command,
    } = await import('@aws-sdk/client-s3');
    const client = new S3Client({});
    const bucket = this.config.coldTierBucket!;

    return {
      async upload(key: string, data: Buffer) {
        await client.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: data })
        );
      },
      async download(key: string) {
        try {
          const res = await client.send(
            new GetObjectCommand({ Bucket: bucket, Key: key })
          );
          const bytes = await res.Body?.transformToByteArray();
          return bytes ? Buffer.from(bytes) : null;
        } catch {
          return null;
        }
      },
      async exists(key: string) {
        try {
          await client.send(
            new HeadObjectCommand({ Bucket: bucket, Key: key })
          );
          return true;
        } catch {
          return false;
        }
      },
      async delete(key: string) {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key })
        );
      },
      async list(prefix: string) {
        const res = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })
        );
        return (res.Contents ?? []).map((c) => c.Key!).filter(Boolean);
      },
    };
  }

  private async createGCSProvider(): Promise<ColdStorageProvider> {
    const { Storage } = await import('@google-cloud/storage');
    const storage = new Storage();
    const bucket = storage.bucket(this.config.coldTierBucket!);

    return {
      async upload(key: string, data: Buffer) {
        await bucket.file(key).save(data);
      },
      async download(key: string) {
        try {
          const [data] = await bucket.file(key).download();
          return data;
        } catch {
          return null;
        }
      },
      async exists(key: string) {
        const [fileExists] = await bucket.file(key).exists();
        return fileExists;
      },
      async delete(key: string) {
        await bucket.file(key).delete();
      },
      async list(prefix: string) {
        const [files] = await bucket.getFiles({ prefix });
        return files.map((f) => f.name);
      },
    };
  }
}
