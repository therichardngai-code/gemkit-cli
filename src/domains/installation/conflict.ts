/**
 * Conflict detection for file updates
 */

import { existsSync, readFileSync } from 'fs';
import { hashFile } from '../../services/hash.js';
import { loadMetadata } from './metadata.js';

export interface ConflictInfo {
  path: string;
  type: 'modified' | 'deleted' | 'new';
  localHash?: string;
  originalHash?: string;
}

/**
 * Detect conflicts between local changes and update
 */
export function detectConflicts(projectDir?: string): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  const metadata = loadMetadata(projectDir);

  if (!metadata) {
    return conflicts;
  }

  // Check customized files
  for (const custom of metadata.customizedFiles) {
    if (!existsSync(custom.path)) {
      conflicts.push({
        path: custom.path,
        type: 'deleted',
        originalHash: custom.hash,
      });
    } else {
      const currentHash = hashFile(custom.path);
      if (currentHash !== custom.hash) {
        conflicts.push({
          path: custom.path,
          type: 'modified',
          localHash: currentHash || undefined,
          originalHash: custom.hash,
        });
      }
    }
  }

  return conflicts;
}
