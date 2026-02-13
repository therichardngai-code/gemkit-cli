/**
 * Team storage utilities - path management and atomic writes
 * Following patterns from src/domains/session/writer.ts
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { sanitizeProjectPath } from '../../utils/paths.js';

// ============================================================================
// Base paths
// ============================================================================

export const GEMKIT_HOME = join(homedir(), '.gemkit');
export const TEAMS_BASE_DIR = join(GEMKIT_HOME, 'teams');

// ============================================================================
// Directory structure helpers
// ============================================================================

/**
 * Get teams directory for a project
 * Storage: ~/.gemkit/teams/{sanitizedProjectDir}/
 */
export function getTeamsDir(projectDir: string): string {
  const sanitized = sanitizeProjectPath(projectDir);
  return join(TEAMS_BASE_DIR, sanitized);
}

/**
 * Get team file path
 * Storage: ~/.gemkit/teams/{projectDir}/team-{teamId}.json
 */
export function getTeamPath(projectDir: string, teamId: string): string {
  return join(getTeamsDir(projectDir), `team-${teamId}.json`);
}

/**
 * Get ports registry path
 * Storage: ~/.gemkit/teams/{projectDir}/ports.json
 */
export function getPortsPath(projectDir: string): string {
  return join(getTeamsDir(projectDir), 'ports.json');
}

/**
 * Get tasks directory for a team
 * Storage: ~/.gemkit/teams/{projectDir}/tasks/
 */
export function getTasksDir(projectDir: string): string {
  return join(getTeamsDir(projectDir), 'tasks');
}

/**
 * Get task file path
 * Storage: ~/.gemkit/teams/{projectDir}/tasks/task-{taskId}.json
 */
export function getTaskPath(projectDir: string, taskId: string): string {
  return join(getTasksDir(projectDir), `task-${taskId}.json`);
}

/**
 * Get tasks index path
 * Storage: ~/.gemkit/teams/{projectDir}/tasks/index.json
 */
export function getTasksIndexPath(projectDir: string): string {
  return join(getTasksDir(projectDir), 'index.json');
}

/**
 * Get central inbox path for a team
 * Storage: ~/.gemkit/teams/{projectDir}/inbox-{teamId}.jsonl
 */
export function getInboxPath(projectDir: string, teamId: string): string {
  return join(getTeamsDir(projectDir), `inbox-${teamId}.jsonl`);
}

// ============================================================================
// File operations
// ============================================================================

/**
 * Ensure directory exists
 */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Atomic write - write to temp file then rename
 * Prevents partial writes on crash
 */
export function atomicWrite(filePath: string, data: unknown): boolean {
  const tempPath = `${filePath}.tmp`;

  try {
    const content = JSON.stringify(data, null, 2);
    writeFileSync(tempPath, content, 'utf8');
    renameSync(tempPath, filePath);
    return true;
  } catch (error) {
    // Clean up temp file on error
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch { /* ignore cleanup errors */ }
    return false;
  }
}

/**
 * Read JSON file safely
 */
export function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Delete file if exists
 */
export function deleteFile(filePath: string): boolean {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * List files matching pattern in directory
 */
export function listFiles(dirPath: string, prefix: string, suffix: string): string[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  try {
    const files = readdirSync(dirPath);
    return files.filter(f => f.startsWith(prefix) && f.endsWith(suffix));
  } catch {
    return [];
  }
}

/**
 * Delete directory recursively (for cleanup)
 */
export function deleteDir(dirPath: string): boolean {
  if (!existsSync(dirPath)) {
    return true;
  }

  try {
    rmSync(dirPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Initialization helpers
// ============================================================================

/**
 * Initialize team storage structure for a project
 */
export function initTeamStorage(projectDir: string): void {
  ensureDir(getTeamsDir(projectDir));
  ensureDir(getTasksDir(projectDir));
}
