/**
 * GitHub releases API - Public repos only, no auth
 */

import type { Release } from '../../types/index.js';
import { loadConfig } from '../config/manager.js';
import { getCache, setCache } from '../cache/manager.js';
import { GitHubError } from '../../utils/errors.js';

const CACHE_KEY = 'github-releases';
const CACHE_TTL = 300; // 5 minutes

/**
 * Fetch releases from GitHub
 */
export async function fetchReleases(limit: number = 10): Promise<Release[]> {
  // Check cache first
  const cached = getCache<Release[]>(CACHE_KEY);
  if (cached) {
    return cached.slice(0, limit);
  }

  const config = loadConfig();
  const { repo, apiUrl } = config.github;
  const url = `${apiUrl}/repos/${repo}/releases?per_page=${limit}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'gemkit-cli',
      },
    });

    if (!response.ok) {
      throw new GitHubError(`Failed to fetch releases: ${response.status}`);
    }

    const data = await response.json() as Array<{
      tag_name: string;
      published_at: string;
      prerelease: boolean;
      assets: Array<{
        name: string;
        url: string;
        size: number;
        browser_download_url: string;
      }>;
    }>;

    const releases: Release[] = data.map(r => ({
      version: r.tag_name.replace(/^v/, ''),
      tag: r.tag_name,
      publishedAt: r.published_at,
      prerelease: r.prerelease,
      assets: r.assets.map(a => ({
        name: a.name,
        url: a.url,
        size: a.size,
        downloadUrl: a.browser_download_url,
      })),
    }));

    // Cache results
    setCache(CACHE_KEY, releases, CACHE_TTL);

    return releases;
  } catch (error) {
    if (error instanceof GitHubError) {
      throw error;
    }
    throw new GitHubError(`Failed to fetch releases: ${error}`);
  }
}

/**
 * Get latest release
 */
export async function getLatestRelease(): Promise<Release | null> {
  const releases = await fetchReleases(1);
  return releases.length > 0 ? releases[0] : null;
}

/**
 * Get release by version
 */
export async function getReleaseByVersion(version: string): Promise<Release | null> {
  const releases = await fetchReleases(50);
  return releases.find(r => r.version === version || r.tag === version) || null;
}
