/**
 * GitHub download utilities
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import type { Release, ReleaseAsset } from '../../types/index.js';
import { GEMKIT_CACHE_DIR } from '../../utils/paths.js';
import { GitHubError } from '../../utils/errors.js';

/**
 * Download release asset
 */
export async function downloadAsset(
  asset: ReleaseAsset,
  destDir: string = GEMKIT_CACHE_DIR
): Promise<string> {
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  const destPath = join(destDir, asset.name);

  try {
    const response = await fetch(asset.downloadUrl, {
      headers: {
        'User-Agent': 'gemkit-cli',
      },
    });

    if (!response.ok) {
      throw new GitHubError(`Failed to download asset: ${response.status}`);
    }

    if (!response.body) {
      throw new GitHubError('No response body');
    }

    const fileStream = createWriteStream(destPath);
    // @ts-ignore - Node.js stream compatibility
    await pipeline(response.body, fileStream);

    return destPath;
  } catch (error) {
    if (error instanceof GitHubError) {
      throw error;
    }
    throw new GitHubError(`Download failed: ${error}`);
  }
}

/**
 * Download release tarball
 */
export async function downloadRelease(release: Release): Promise<string> {
  // Find tarball asset
  const tarball = release.assets.find(a =>
    a.name.endsWith('.tar.gz') || a.name.endsWith('.tgz')
  );

  if (!tarball) {
    throw new GitHubError('No tarball asset found in release');
  }

  return downloadAsset(tarball);
}
