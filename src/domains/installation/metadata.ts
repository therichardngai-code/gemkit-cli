/**
 * Installation metadata management
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { GemKitMetadata } from '../../types/index.js';
import { getLocalMetadataPath } from '../../utils/paths.js';

/**
 * Load installation metadata
 */
export function loadMetadata(projectDir?: string): GemKitMetadata | null {
  const metadataPath = getLocalMetadataPath(projectDir);

  if (!existsSync(metadataPath)) {
    return null;
  }

  try {
    const content = readFileSync(metadataPath, 'utf-8');
    return JSON.parse(content) as GemKitMetadata;
  } catch {
    return null;
  }
}

/**
 * Save installation metadata
 */
export function saveMetadata(metadata: GemKitMetadata, projectDir?: string): void {
  const metadataPath = getLocalMetadataPath(projectDir);
  const dir = dirname(metadataPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}

/**
 * Create initial metadata
 */
export function createMetadata(
  version: string,
  scope: 'local' | 'global',
  installedFiles: string[]
): GemKitMetadata {
  return {
    name: 'gemkit',
    version,
    installedAt: new Date().toISOString(),
    scope,
    installedFiles,
    customizedFiles: [],
  };
}

/**
 * Check if GemKit is installed
 */
export function isInstalled(projectDir?: string): boolean {
  return loadMetadata(projectDir) !== null;
}
