/**
 * NPM Registry service - Check package versions
 */

import { getCache, setCache } from '../domains/cache/manager.js';

const NPM_REGISTRY = 'https://registry.npmjs.org';
const CACHE_KEY = 'npm-version';
const CACHE_TTL = 3600; // 1 hour

export interface NpmPackageInfo {
  name: string;
  version: string;
  description?: string;
  publishedAt?: string;
}

/**
 * Get latest version of a package from npm registry
 */
export async function getLatestNpmVersion(packageName: string): Promise<NpmPackageInfo | null> {
  const cacheKey = `${CACHE_KEY}-${packageName}`;

  // Check cache first
  const cached = getCache<NpmPackageInfo>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(`${NPM_REGISTRY}/${packageName}/latest`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'gemkit-cli',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      name: string;
      version: string;
      description?: string;
      time?: Record<string, string>;
    };

    const info: NpmPackageInfo = {
      name: data.name,
      version: data.version,
      description: data.description,
      publishedAt: data.time?.[data.version],
    };

    // Cache result
    setCache(cacheKey, info, CACHE_TTL);

    return info;
  } catch {
    return null;
  }
}

/**
 * Compare two semver versions
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.replace(/^v/, '').split('.').map(Number);
  const partsB = b.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;

    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }

  return 0;
}

/**
 * Check if update is available
 */
export function isUpdateAvailable(current: string, latest: string): boolean {
  return compareVersions(latest, current) > 0;
}