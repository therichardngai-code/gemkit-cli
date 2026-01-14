/**
 * File synchronization for installation/update
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'fs';
import { join, dirname, relative } from 'path';
import { hashFile } from '../../services/hash.js';

export interface SyncResult {
  added: string[];
  updated: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Sync files from source to destination
 */
export function syncFiles(
  sourceDir: string,
  destDir: string,
  options: { force?: boolean; excludePatterns?: string[] } = {}
): SyncResult {
  const result: SyncResult = {
    added: [],
    updated: [],
    skipped: [],
    errors: [],
  };

  if (!existsSync(sourceDir)) {
    result.errors.push(`Source directory not found: ${sourceDir}`);
    return result;
  }

  const files = getAllFiles(sourceDir);

  for (const file of files) {
    const relativePath = relative(sourceDir, file);
    const destPath = join(destDir, relativePath);

    // Check exclude patterns
    if (options.excludePatterns?.some(p => relativePath.includes(p))) {
      result.skipped.push(relativePath);
      continue;
    }

    try {
      // Ensure destination directory exists
      const destDirPath = dirname(destPath);
      if (!existsSync(destDirPath)) {
        mkdirSync(destDirPath, { recursive: true });
      }

      if (!existsSync(destPath)) {
        // New file
        copyFileSync(file, destPath);
        result.added.push(relativePath);
      } else if (options.force) {
        // Force update
        copyFileSync(file, destPath);
        result.updated.push(relativePath);
      } else {
        // Check if file changed
        const sourceHash = hashFile(file);
        const destHash = hashFile(destPath);

        if (sourceHash !== destHash) {
          result.skipped.push(relativePath);
        }
      }
    } catch (error) {
      result.errors.push(`Failed to sync ${relativePath}: ${error}`);
    }
  }

  return result;
}

/**
 * Get all files in directory recursively
 */
function getAllFiles(dir: string): string[] {
  const files: string[] = [];

  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}
