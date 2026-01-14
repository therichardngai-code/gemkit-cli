/**
 * Environment variable utilities for session management
 * Aligned with gk-session-manager.cjs readEnv()
 */

import { existsSync, readFileSync } from 'fs';
import { getLocalEnvPath, sanitizeProjectPath } from '../../utils/paths.js';
import { generateProjectHash } from '../../services/hash.js';

/**
 * Environment data structure matching gk-session-manager.cjs
 */
export interface GkEnvData {
  // GemKit IDs
  ACTIVE_GK_SESSION_ID: string;
  GK_PROJECT_HASH: string;
  PROJECT_DIR: string;

  // Gemini IDs (mapped)
  ACTIVE_GEMINI_SESSION_ID: string;
  GEMINI_PROJECT_HASH: string;
  GEMINI_PARENT_ID: string;

  // Plan info
  ACTIVE_PLAN: string;
  SUGGESTED_PLAN: string;
  PLAN_DATE_FORMAT: string;
}

/**
 * Read environment variables from .gemini/.env
 * Matches gk-session-manager.cjs readEnv()
 */
export function readEnv(projectPath: string = process.cwd()): GkEnvData {
  const result: GkEnvData = {
    // GemKit IDs
    ACTIVE_GK_SESSION_ID: '',
    GK_PROJECT_HASH: '',
    PROJECT_DIR: '',

    // Gemini IDs (mapped)
    ACTIVE_GEMINI_SESSION_ID: '',
    GEMINI_PROJECT_HASH: '',
    GEMINI_PARENT_ID: '',

    // Plan info
    ACTIVE_PLAN: '',
    SUGGESTED_PLAN: '',
    PLAN_DATE_FORMAT: ''
  };

  const envPath = getLocalEnvPath(projectPath);
  if (!existsSync(envPath)) {
    return result;
  }

  try {
    const content = readFileSync(envPath, 'utf-8');

    // GemKit IDs
    const gkSessionMatch = content.match(/^ACTIVE_GK_SESSION_ID=(.*)$/m);
    if (gkSessionMatch) result.ACTIVE_GK_SESSION_ID = gkSessionMatch[1].trim();

    const gkHashMatch = content.match(/^GK_PROJECT_HASH=(.*)$/m);
    if (gkHashMatch) result.GK_PROJECT_HASH = gkHashMatch[1].trim();

    const projectDirMatch = content.match(/^PROJECT_DIR=(.*)$/m);
    if (projectDirMatch) result.PROJECT_DIR = projectDirMatch[1].trim();

    // Gemini IDs
    const geminiSessionMatch = content.match(/^ACTIVE_GEMINI_SESSION_ID=(.*)$/m);
    if (geminiSessionMatch) result.ACTIVE_GEMINI_SESSION_ID = geminiSessionMatch[1].trim();

    const geminiHashMatch = content.match(/^GEMINI_PROJECT_HASH=(.*)$/m);
    if (geminiHashMatch) result.GEMINI_PROJECT_HASH = geminiHashMatch[1].trim();

    const geminiParentMatch = content.match(/^GEMINI_PARENT_ID=(.*)$/m);
    if (geminiParentMatch) result.GEMINI_PARENT_ID = geminiParentMatch[1].trim();

    // Plan info
    const activePlanMatch = content.match(/^ACTIVE_PLAN=(.*)$/m);
    if (activePlanMatch) result.ACTIVE_PLAN = activePlanMatch[1].trim();

    const suggestedPlanMatch = content.match(/^SUGGESTED_PLAN=(.*)$/m);
    if (suggestedPlanMatch) result.SUGGESTED_PLAN = suggestedPlanMatch[1].trim();

    const dateFormatMatch = content.match(/^PLAN_DATE_FORMAT=(.*)$/m);
    if (dateFormatMatch) result.PLAN_DATE_FORMAT = dateFormatMatch[1].trim();
  } catch (e) {
    // Return empty values on error
  }

  return result;
}

/**
 * Get active GK session ID from .gemini/.env
 */
export function getActiveGkSessionId(projectPath: string = process.cwd()): string | undefined {
  const env = readEnv(projectPath);
  return env.ACTIVE_GK_SESSION_ID || undefined;
}

/**
 * Get active Gemini session ID from .gemini/.env
 */
export function getActiveGeminiSessionId(projectPath: string = process.cwd()): string | undefined {
  const env = readEnv(projectPath);
  return env.ACTIVE_GEMINI_SESSION_ID || undefined;
}

/**
 * Get project directory from .gemini/.env or derive from cwd
 */
export function getProjectDir(projectPath: string = process.cwd()): string {
  const env = readEnv(projectPath);
  if (env.PROJECT_DIR) return env.PROJECT_DIR;
  return sanitizeProjectPath(projectPath);
}

/**
 * Get GK project hash from .gemini/.env
 */
export function getGkProjectHash(projectPath: string = process.cwd()): string | undefined {
  const env = readEnv(projectPath);
  return env.GK_PROJECT_HASH || undefined;
}

/**
 * Get Gemini project hash from .gemini/.env
 */
export function getGeminiProjectHash(projectPath: string = process.cwd()): string | undefined {
  const env = readEnv(projectPath);
  return env.GEMINI_PROJECT_HASH || undefined;
}

/**
 * Get active plan from .gemini/.env
 */
export function getActivePlan(projectPath: string = process.cwd()): string | undefined {
  const env = readEnv(projectPath);
  return env.ACTIVE_PLAN || undefined;
}

/**
 * Get suggested plan from .gemini/.env
 */
export function getSuggestedPlan(projectPath: string = process.cwd()): string | undefined {
  const env = readEnv(projectPath);
  return env.SUGGESTED_PLAN || undefined;
}
