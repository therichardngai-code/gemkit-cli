/**
 * Session manager - READ-ONLY operations
 * Reads session data created by gk-session-manager.cjs hooks
 *
 * Storage: ~/.gemkit/projects/{projectDir}/gk-session-{gkSessionId}.json
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { GkSession, GkAgent, GkProject, SessionListOptions, AgentFilterOptions, SessionMetrics } from './types.js';
import { getProjectDataDir, getSessionPath, getProjectPath, GEMKIT_PROJECTS_DIR } from '../../utils/paths.js';
import { getProjectDir, getActiveGkSessionId, readEnv } from './env.js';

/**
 * Get session by ID
 * Matches gk-session-manager.cjs getSession()
 */
export function getSession(projectDir: string, gkSessionId: string): GkSession | null {
  if (!projectDir || !gkSessionId) return null;

  const sessionPath = getSessionPath(projectDir, gkSessionId);
  if (!existsSync(sessionPath)) {
    return null;
  }

  try {
    const content = readFileSync(sessionPath, 'utf-8');
    return JSON.parse(content) as GkSession;
  } catch (e) {
    return null;
  }
}

/**
 * Get current active session
 */
export function getActiveSession(): GkSession | null {
  const projectDir = getProjectDir();
  const gkSessionId = getActiveGkSessionId();

  if (!gkSessionId) return null;
  return getSession(projectDir, gkSessionId);
}

/**
 * Check if session exists
 */
export function sessionExists(projectDir: string, gkSessionId: string): boolean {
  if (!projectDir || !gkSessionId) return false;
  return existsSync(getSessionPath(projectDir, gkSessionId));
}

/**
 * List all sessions for a project
 */
export function listSessions(projectDir: string, options: SessionListOptions = {}): GkSession[] {
  const { limit = 10, status = 'all' } = options;
  const projectDataDir = getProjectDataDir(projectDir);

  if (!existsSync(projectDataDir)) {
    return [];
  }

  const sessions: GkSession[] = [];

  try {
    const files = readdirSync(projectDataDir)
      .filter(f => f.startsWith('gk-session-') && f.endsWith('.json'));

    for (const file of files) {
      const filePath = join(projectDataDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const session = JSON.parse(content) as GkSession;

      // Filter by status
      if (status !== 'all') {
        const mainAgent = session.agents?.find(a => a.agentType === 'Main Agent');
        const sessionStatus = mainAgent?.status || 'active';
        if (sessionStatus !== status) continue;
      }

      sessions.push(session);
    }
  } catch (e) {
    // Return empty on error
  }

  // Sort by initTimestamp, newest first
  sessions.sort((a, b) =>
    new Date(b.initTimestamp).getTime() - new Date(a.initTimestamp).getTime()
  );

  return sessions.slice(0, limit);
}

/**
 * List all projects
 */
export function listProjects(): string[] {
  if (!existsSync(GEMKIT_PROJECTS_DIR)) {
    return [];
  }

  try {
    return readdirSync(GEMKIT_PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch (e) {
    return [];
  }
}

/**
 * Get project metadata
 * Matches gk-session-manager.cjs getProject()
 */
export function getProject(projectDir: string, gkProjectHash: string): GkProject | null {
  if (!projectDir || !gkProjectHash) return null;

  const projectPath = getProjectPath(projectDir, gkProjectHash);
  if (!existsSync(projectPath)) {
    return null;
  }

  try {
    const content = readFileSync(projectPath, 'utf-8');
    return JSON.parse(content) as GkProject;
  } catch (e) {
    return null;
  }
}

/**
 * Get agents from session
 * Matches gk-session-manager.cjs getAgents()
 */
export function getAgents(projectDir: string, gkSessionId: string, filters: AgentFilterOptions = {}): GkAgent[] {
  const session = getSession(projectDir, gkSessionId);
  if (!session || !session.agents) return [];

  let agents = session.agents;

  if (filters.agentType) {
    agents = agents.filter(a => a.agentType === filters.agentType);
  }
  if (filters.status) {
    agents = agents.filter(a => a.status === filters.status);
  }

  return agents;
}

/**
 * Get session metrics
 * Matches gk-session-manager.cjs getMetrics()
 */
export function getMetrics(projectDir: string, gkSessionId: string): SessionMetrics {
  const agents = getAgents(projectDir, gkSessionId);

  const metrics: SessionMetrics = {
    total: agents.length,
    active: 0,
    completed: 0,
    failed: 0,
    mainAgents: 0,
    subAgents: 0,
    totalDurationMs: 0
  };

  agents.forEach(agent => {
    if (agent.status === 'active') metrics.active++;
    else if (agent.status === 'completed') metrics.completed++;
    else if (agent.status === 'failed') metrics.failed++;

    if (agent.agentType === 'Main Agent') metrics.mainAgents++;
    else metrics.subAgents++;

    if (agent.startTime && agent.endTime) {
      metrics.totalDurationMs += new Date(agent.endTime).getTime() - new Date(agent.startTime).getTime();
    }
  });

  return metrics;
}

/**
 * Find session by Gemini session ID
 * Matches gk-session-manager.cjs findSessionByGeminiId()
 */
export function findSessionByGeminiId(projectDir: string, geminiSessionId: string): GkSession | null {
  if (!projectDir || !geminiSessionId) return null;

  const projectDataDir = getProjectDataDir(projectDir);
  if (!existsSync(projectDataDir)) return null;

  try {
    const files = readdirSync(projectDataDir)
      .filter(f => f.startsWith('gk-session-') && f.endsWith('.json'));

    for (const file of files) {
      const filePath = join(projectDataDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const session = JSON.parse(content) as GkSession;

      if (session.geminiSessionId === geminiSessionId) {
        return session;
      }
    }
  } catch (e) {
    // Ignore errors
  }

  return null;
}

/**
 * Get sub-agents from current session
 */
export function getSubAgents(projectDir: string, gkSessionId: string): GkAgent[] {
  return getAgents(projectDir, gkSessionId, { agentType: 'Sub Agent' });
}

/**
 * Get main agent from session
 */
export function getMainAgent(projectDir: string, gkSessionId: string): GkAgent | null {
  const agents = getAgents(projectDir, gkSessionId, { agentType: 'Main Agent' });
  return agents[0] || null;
}
