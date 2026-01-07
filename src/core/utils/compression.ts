/**
 * Compression utilities for storage optimization
 */

import zlib from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);
const brotliCompressAsync = promisify(zlib.brotliCompress);
const brotliDecompressAsync = promisify(zlib.brotliDecompress);

export enum CompressionType {
  NONE = 'none',
  GZIP = 'gzip',
  BROTLI = 'brotli',
}

export interface CompressionOptions {
  type?: CompressionType;
  level?: number;
}

/**
 * Compress data using specified algorithm
 */
export async function compress(
  data: string | Buffer,
  options: CompressionOptions = {}
): Promise<Buffer> {
  const { type = CompressionType.GZIP, level = 6 } = options;
  
  const input = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  
  switch (type) {
    case CompressionType.NONE:
      return input;
      
    case CompressionType.GZIP:
      return gzipAsync(input, { level });
      
    case CompressionType.BROTLI:
      return brotliCompressAsync(input, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: level,
        },
      });
      
    default:
      throw new Error(`Unknown compression type: ${type}`);
  }
}

/**
 * Decompress data
 */
export async function decompress(
  data: Buffer,
  type: CompressionType = CompressionType.GZIP
): Promise<string> {
  let decompressed: Buffer;
  
  switch (type) {
    case CompressionType.NONE:
      decompressed = data;
      break;
      
    case CompressionType.GZIP:
      decompressed = await gunzipAsync(data);
      break;
      
    case CompressionType.BROTLI:
      decompressed = await brotliDecompressAsync(data);
      break;
      
    default:
      throw new Error(`Unknown compression type: ${type}`);
  }
  
  return decompressed.toString('utf8');
}

/**
 * Calculate compression ratio
 */
export function compressionRatio(original: number, compressed: number): number {
  if (original === 0) return 0;
  return (1 - compressed / original) * 100;
}

/**
 * Auto-detect compression type from buffer
 */
export function detectCompressionType(data: Buffer): CompressionType {
  // Check for gzip magic number
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    return CompressionType.GZIP;
  }
  
  // Check for brotli
  // Brotli doesn't have a consistent magic number, but we can try to decompress
  // This is a heuristic approach
  if (data.length >= 4 && data[0] === 0xce && data[1] === 0xb2) {
    return CompressionType.BROTLI;
  }
  
  return CompressionType.NONE;
}

/**
 * Choose optimal compression based on data characteristics
 */
export function chooseOptimalCompression(
  data: string | Buffer,
  speedPriority: boolean = false
): CompressionType {
  const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
  
  // Don't compress small data
  if (size < 1024) {
    return CompressionType.NONE;
  }
  
  // Use gzip for speed priority or medium data
  if (speedPriority || size < 100 * 1024) {
    return CompressionType.GZIP;
  }
  
  // Use brotli for large data and better compression
  return CompressionType.BROTLI;
}