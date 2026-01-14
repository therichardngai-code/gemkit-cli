/**
 * Path constants and utilities for GemKit CLI
 * Aligned with gk-session-manager.cjs
 */

import { homedir } from 'os';
import { join } from 'path';

// Global paths - aligned with gk-session-manager.cjs
export const GEMKIT_HOME = join(homedir(), '.gemkit');
export const GEMKIT_PROJECTS_DIR = join(GEMKIT_HOME, 'projects');

// Legacy paths (for backwards compatibility)
export const GEMINI_HOME = join(homedir(), '.gemini');
export const GEMKIT_CONFIG_DIR = join(GEMINI_HOME, 'config');
export const GEMKIT_CACHE_DIR = join(GEMINI_HOME, 'cache');
export const GEMKIT_TMP_DIR = join(GEMINI_HOME, 'tmp');

// Local paths (relative to project)
export const LOCAL_GEMINI_DIR = '.gemini';
export const LOCAL_AGENT_DIR = '.agent';
export const LOCAL_PLANS_DIR = 'plans';

// File names
export const CONFIG_FILE = '.gk.json';
export const METADATA_FILE = 'metadata.json';
export const ENV_FILE = '.env';

// Get local paths
export function getLocalGeminiDir(projectDir: string = process.cwd()): string {
  return join(projectDir, LOCAL_GEMINI_DIR);
}

export function getLocalConfigPath(projectDir: string = process.cwd()): string {
  return join(projectDir, LOCAL_GEMINI_DIR, CONFIG_FILE);
}

export function getLocalMetadataPath(projectDir: string = process.cwd()): string {
  return join(projectDir, LOCAL_GEMINI_DIR, METADATA_FILE);
}

export function getLocalEnvPath(projectDir: string = process.cwd()): string {
  return join(projectDir, LOCAL_GEMINI_DIR, ENV_FILE);
}

export function getAgentsDir(projectDir: string = process.cwd()): string {
  return join(projectDir, LOCAL_GEMINI_DIR, 'agents');
}

export function getExtensionsDir(projectDir: string = process.cwd()): string {
  return join(projectDir, LOCAL_GEMINI_DIR, 'extensions');
}

export function getPlansDir(projectDir: string = process.cwd()): string {
  return join(projectDir, LOCAL_PLANS_DIR);
}

/**
 * Sanitize path to create safe directory name
 * Matches gk-session-manager.cjs sanitizeProjectPath()
 */
export function sanitizeProjectPath(projectPath: string): string {
  if (!projectPath) return '';
  return projectPath
    .replace(/^[A-Za-z]:/, m => m.replace(':', '')) // C: -> C
    .replace(/[\\/]+/g, '-')  // path separators to hyphens
    .replace(/[^a-zA-Z0-9-]/g, '-')  // other special chars to hyphens
    .replace(/-+/g, '-')  // collapse multiple hyphens
    .replace(/^-|-$/g, '');  // trim leading/trailing hyphens
}

/**
 * Get project data directory
 * Matches gk-session-manager.cjs getProjectDataDir()
 * Storage: ~/.gemkit/projects/{projectDir}/
 */
export function getProjectDataDir(projectDir: string): string {
  return join(GEMKIT_PROJECTS_DIR, projectDir);
}

/**
 * Get session file path
 * Matches gk-session-manager.cjs getSessionPath()
 */
export function getSessionPath(projectDir: string, gkSessionId: string): string {
  return join(getProjectDataDir(projectDir), `gk-session-${gkSessionId}.json`);
}

/**
 * Get project file path
 * Matches gk-session-manager.cjs getProjectPath()
 */
export function getProjectPath(projectDir: string, gkProjectHash: string): string {
  return join(getProjectDataDir(projectDir), `gk-project-${gkProjectHash}.json`);
}

export function getTempDir(projectHash?: string): string {
  if (projectHash) {
    return join(GEMKIT_TMP_DIR, projectHash);
  }
  return GEMKIT_TMP_DIR;
}

export function getCacheDir(): string {
  return GEMKIT_CACHE_DIR;
}
