/**
 * Cache manager for releases
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { GEMKIT_CACHE_DIR } from '../../utils/paths.js';

interface CacheEntry {
  key: string;
  data: unknown;
  timestamp: number;
  ttl: number;
}

/**
 * Get cache directory path
 */
function getCacheDir(): string {
  if (!existsSync(GEMKIT_CACHE_DIR)) {
    mkdirSync(GEMKIT_CACHE_DIR, { recursive: true });
  }
  return GEMKIT_CACHE_DIR;
}

/**
 * Get cache file path for key
 */
function getCacheFilePath(key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9-_]/g, '_');
  return join(getCacheDir(), `${safeKey}.json`);
}

/**
 * Get cached value
 */
export function getCache<T>(key: string): T | null {
  const filePath = getCacheFilePath(key);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const entry = JSON.parse(content) as CacheEntry;

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl * 1000) {
      unlinkSync(filePath);
      return null;
    }

    return entry.data as T;
  } catch {
    return null;
  }
}

/**
 * Set cached value
 */
export function setCache<T>(key: string, data: T, ttl: number = 3600): void {
  const filePath = getCacheFilePath(key);

  const entry: CacheEntry = {
    key,
    data,
    timestamp: Date.now(),
    ttl,
  };

  writeFileSync(filePath, JSON.stringify(entry, null, 2));
}

/**
 * Clear all cache
 */
export function clearCache(): number {
  const cacheDir = getCacheDir();
  const files = readdirSync(cacheDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    unlinkSync(join(cacheDir, file));
  }

  return files.length;
}

/**
 * Get cache stats
 */
export function getCacheStats(): { entries: number; size: number } {
  const cacheDir = getCacheDir();
  const files = readdirSync(cacheDir).filter(f => f.endsWith('.json'));

  let totalSize = 0;
  for (const file of files) {
    const stat = statSync(join(cacheDir, file));
    totalSize += stat.size;
  }

  return {
    entries: files.length,
    size: totalSize,
  };
}
