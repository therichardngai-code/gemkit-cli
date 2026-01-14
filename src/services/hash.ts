/**
 * Hashing utilities for project identification
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';

/**
 * Generate SHA256 hash of a string
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generate short hash (first 8 characters)
 */
export function shortHash(input: string): string {
  return sha256(input).substring(0, 8);
}

/**
 * Generate project hash from directory path
 */
export function generateProjectHash(projectDir: string): string {
  // Normalize path for consistent hashing
  const normalized = projectDir.replace(/\\/g, '/').toLowerCase();
  return shortHash(normalized);
}

/**
 * Generate file hash for change detection
 */
export function hashFile(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Generate hash from multiple inputs
 */
export function combineHash(...inputs: string[]): string {
  const combined = inputs.join(':');
  return sha256(combined);
}

/**
 * Generate unique ID with timestamp
 */
export function generateUniqueId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}

/**
 * Generate gkSessionId - consistent format for ALL clients
 * Matches gk-session-manager.cjs generateGkSessionId()
 *
 * @param appName - Application identifier (e.g., 'gemini-main', 'vscode')
 * @param pid - Process ID to embed in the session ID
 * @returns Format: "{appName}-{PID}-{timestamp36}-{random4}"
 */
export function generateGkSessionId(appName: string, pid: number): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${appName}-${pid}-${timestamp}-${random}`;
}
