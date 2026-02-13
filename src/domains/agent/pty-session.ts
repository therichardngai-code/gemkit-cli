/**
 * PTY Session State Management
 * Handles persistence of interactive session state
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { PtySessionState } from './pty-types.js';

const SESSION_FILE = '.gk-interactive-session.json';

/**
 * Get the session file path
 * For team mode, use agent-specific session file
 */
export function getSessionFilePath(cwd?: string, agentName?: string): string {
  const baseName = agentName
    ? `.gk-interactive-session-${agentName}.json`
    : SESSION_FILE;
  return join(cwd || process.cwd(), baseName);
}

/**
 * Load session state from file
 */
export function loadSession(cwd?: string, agentName?: string): PtySessionState | null {
  const filePath = getSessionFilePath(cwd, agentName);
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as PtySessionState;
  } catch {
    return null;
  }
}

/**
 * Save session state to file
 */
export function saveSession(state: PtySessionState, cwd?: string, agentName?: string): void {
  const filePath = getSessionFilePath(cwd, agentName);
  writeFileSync(filePath, JSON.stringify(state, null, 2));
}

/**
 * Clear session state file
 */
export function clearSession(cwd?: string, agentName?: string): void {
  const filePath = getSessionFilePath(cwd, agentName);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

/**
 * Check if a session is currently active (process running)
 */
export function isSessionActive(cwd?: string, agentName?: string): boolean {
  const session = loadSession(cwd, agentName);
  if (!session) return false;

  // Check if process is still running
  try {
    process.kill(session.pid, 0);
    return true;
  } catch {
    // Process not running, clean up stale session
    clearSession(cwd, agentName);
    return false;
  }
}

/**
 * Mark first send as complete
 */
export function markFirstSendComplete(cwd?: string, agentName?: string): void {
  const session = loadSession(cwd, agentName);
  if (session) {
    session.isFirstSend = false;
    saveSession(session, cwd, agentName);
  }
}

/**
 * Update session PID after server starts
 */
export function updateSessionPid(pid: number, cwd?: string, agentName?: string): void {
  const session = loadSession(cwd, agentName);
  if (session) {
    session.pid = pid;
    saveSession(session, cwd, agentName);
  }
}
