/**
 * Session writer - WRITE operations
 * Aligned with gk-session-manager.cjs write functions
 *
 * Used by:
 * - gk session init (replaces gk-init.cjs)
 * - gk plan set (replaces gk-set-active-plan.cjs)
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { GkSession, GkAgent, GkProject, GkProjectSession } from './types.js';
import { getProjectDataDir, getSessionPath, getProjectPath, GEMKIT_PROJECTS_DIR, getLocalEnvPath, sanitizeProjectPath } from '../../utils/paths.js';
import { generateProjectHash, generateGkSessionId } from '../../services/hash.js';
import { readEnv, getProjectDir } from './env.js';
import { getSession } from './manager.js';

/**
 * Get parent PID and process name on Windows using CIM
 */
function getProcessInfoWin32(pid: number): { parentPid: number | null; processName: string | null } {
  try {
    const cmd = `powershell -Command "$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; Write-Output $p.ParentProcessId; Write-Output $p.Name"`;
    const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const lines = output.split(/\r?\n/);
    const parentPid = parseInt(lines[0], 10);
    const processName = lines[1] || null;
    return {
      parentPid: (!isNaN(parentPid) && parentPid > 0) ? parentPid : null,
      processName: processName
    };
  } catch {
    return { parentPid: null, processName: null };
  }
}

/**
 * Check if a process name is a shell
 */
function isShellProcess(name: string | null): boolean {
  if (!name) return false;
  const shellNames = ['powershell.exe', 'pwsh.exe', 'cmd.exe', 'bash.exe', 'zsh.exe', 'sh.exe', 'fish.exe'];
  return shellNames.includes(name.toLowerCase());
}

/**
 * Check if a process name is an IDE/terminal host
 */
function isIDEProcess(name: string | null): boolean {
  if (!name) return false;
  const lowerName = name.toLowerCase();
  const ideNames = [
    'code.exe', 'code - insiders.exe',
    'cursor.exe', 'windsurf.exe', 'positron.exe',
    'idea64.exe', 'idea.exe', 'webstorm64.exe', 'webstorm.exe',
    'pycharm64.exe', 'pycharm.exe', 'phpstorm64.exe', 'phpstorm.exe',
    'goland64.exe', 'goland.exe', 'rustrover64.exe', 'rustrover.exe',
    'rider64.exe', 'rider.exe', 'clion64.exe', 'clion.exe',
    'datagrip64.exe', 'datagrip.exe', 'fleet.exe',
    'windowsterminal.exe', 'sublime_text.exe', 'zed.exe', 'terminal.app'
  ];
  return ideNames.includes(lowerName);
}

/**
 * Get the terminal PID by walking up the process tree
 * Matches gk-session-manager.cjs getTerminalPid()
 */
export function getTerminalPid(): number {
  const parentPid = process.ppid;

  try {
    if (process.platform === 'win32') {
      let currentPid = parentPid;
      let lastShellPid: number | null = null;

      for (let i = 0; i < 10; i++) {
        const { parentPid: nextPid, processName } = getProcessInfoWin32(currentPid);

        if (isShellProcess(processName)) {
          lastShellPid = currentPid;
        }

        if (isIDEProcess(processName) && lastShellPid) {
          return lastShellPid;
        }

        if (!nextPid || nextPid <= 4) break;
        currentPid = nextPid;
      }

      return lastShellPid || parentPid;
    } else {
      // Unix/Linux/macOS - simplified
      return parentPid;
    }
  } catch {
    // Fall back to parent PID on error
  }

  return parentPid;
}

/**
 * Ensure directory exists
 */
function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Reorder session object to put agents array at the end
 */
function reorderSessionFields(session: GkSession): GkSession {
  const { agents, ...rest } = session;
  return {
    ...rest,
    agents: agents || []
  };
}

/**
 * Save session to file (atomic write)
 * Matches gk-session-manager.cjs saveSession()
 */
export function saveSession(projectDir: string, gkSessionId: string, data: GkSession): boolean {
  if (!projectDir || !gkSessionId) return false;

  const projectDataDir = getProjectDataDir(projectDir);
  ensureDir(projectDataDir);

  const sessionPath = getSessionPath(projectDir, gkSessionId);
  const tempPath = `${sessionPath}.tmp`;

  try {
    const orderedData = reorderSessionFields(data);
    writeFileSync(tempPath, JSON.stringify(orderedData, null, 2), 'utf8');
    // Atomic rename
    renameSync(tempPath, sessionPath);
    return true;
  } catch {
    try {
      unlinkSync(tempPath);
    } catch { /* ignore */ }
    return false;
  }
}

/**
 * Update .gemini/.env with session and project info
 * Matches gk-session-manager.cjs updateEnv()
 */
export function updateEnv(envData: {
  gkSessionId?: string;
  gkProjectHash?: string;
  projectDir?: string;
  geminiSessionId?: string;
  geminiProjectHash?: string;
  activePlan?: string;
  suggestedPlan?: string;
  planDateFormat?: string;
}): boolean {
  try {
    const envPath = getLocalEnvPath();
    const content = [
      '# Auto-generated by gemkit-cli',
      `# Updated at: ${new Date().toISOString()}`,
      '',
      '# GEMKIT IDs',
      `ACTIVE_GK_SESSION_ID=${envData.gkSessionId || ''}`,
      `GK_PROJECT_HASH=${envData.gkProjectHash || ''}`,
      `PROJECT_DIR=${envData.projectDir || ''}`,
      '',
      '# GEMINI IDs (mapped)',
      `ACTIVE_GEMINI_SESSION_ID=${envData.geminiSessionId || ''}`,
      `GEMINI_PROJECT_HASH=${envData.geminiProjectHash || ''}`,
      '',
      '# PLAN INFO',
      `ACTIVE_PLAN=${envData.activePlan || ''}`,
      `SUGGESTED_PLAN=${envData.suggestedPlan || ''}`,
      `PLAN_DATE_FORMAT=${envData.planDateFormat || ''}`,
      ''
    ].join('\n');

    // Ensure .gemini directory exists
    const geminiDir = join(process.cwd(), '.gemini');
    ensureDir(geminiDir);

    writeFileSync(envPath, content, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get project data (internal helper)
 */
function getProjectInternal(projectDir: string, gkProjectHash: string): GkProject | null {
  if (!projectDir || !gkProjectHash) return null;

  const projectPath = getProjectPath(projectDir, gkProjectHash);
  if (!existsSync(projectPath)) {
    return null;
  }

  try {
    const content = readFileSync(projectPath, 'utf-8');
    return JSON.parse(content) as GkProject;
  } catch {
    return null;
  }
}

/**
 * Save project data
 */
export function saveProject(projectDir: string, gkProjectHash: string, data: GkProject): boolean {
  if (!projectDir || !gkProjectHash) return false;

  const projectDataDir = getProjectDataDir(projectDir);
  ensureDir(projectDataDir);

  const projectPath = getProjectPath(projectDir, gkProjectHash);

  try {
    writeFileSync(projectPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Create or get project
 */
export function ensureProject(projectDir: string, gkProjectHash: string, projectPath?: string): GkProject {
  let project = getProjectInternal(projectDir, gkProjectHash);

  if (!project) {
    project = {
      gkProjectHash: gkProjectHash,
      projectDir: projectDir,
      projectPath: projectPath || process.cwd(),
      geminiProjectHash: null,

      initialized: true,
      initTimestamp: new Date().toISOString(),
      lastActiveTimestamp: new Date().toISOString(),
      activeGkSessionId: null,

      sessions: []
    };
    saveProject(projectDir, gkProjectHash, project);
  }

  return project;
}

/**
 * Add session summary to project
 */
export function addSessionToProject(projectDir: string, gkProjectHash: string, sessionSummary: Partial<GkProjectSession> & { gkSessionId: string }): boolean {
  const project = ensureProject(projectDir, gkProjectHash);

  project.activeGkSessionId = sessionSummary.gkSessionId;
  project.lastActiveTimestamp = new Date().toISOString();

  const existingIndex = project.sessions.findIndex(s => s.gkSessionId === sessionSummary.gkSessionId);
  if (existingIndex >= 0) {
    const existing = project.sessions[existingIndex];
    project.sessions[existingIndex] = {
      gkSessionId: sessionSummary.gkSessionId,
      pid: sessionSummary.pid ?? existing.pid,
      sessionType: sessionSummary.sessionType || existing.sessionType,
      appName: sessionSummary.appName || existing.appName,
      prompt: sessionSummary.prompt ?? existing.prompt ?? null,
      activePlan: sessionSummary.activePlan ?? existing.activePlan ?? null,
      startTime: sessionSummary.startTime || existing.startTime,
      endTime: sessionSummary.endTime ?? existing.endTime ?? null
    };
  } else {
    project.sessions.push({
      gkSessionId: sessionSummary.gkSessionId,
      pid: sessionSummary.pid ?? null,
      sessionType: sessionSummary.sessionType || 'gemini',
      appName: sessionSummary.appName || 'gemini-main',
      prompt: sessionSummary.prompt ?? null,
      activePlan: sessionSummary.activePlan ?? null,
      startTime: sessionSummary.startTime || new Date().toISOString(),
      endTime: sessionSummary.endTime ?? null
    });
  }

  // Sort sessions by startTime descending
  project.sessions.sort((a, b) => {
    const timeA = new Date(a.startTime || 0).getTime();
    const timeB = new Date(b.startTime || 0).getTime();
    return timeB - timeA;
  });

  return saveProject(projectDir, gkProjectHash, project);
}

/**
 * Add agent to session
 * Matches gk-session-manager.cjs addAgent()
 */
export function addAgent(projectDir: string, gkSessionId: string, agentData: Partial<GkAgent>): boolean {
  const session = getSession(projectDir, gkSessionId);
  if (!session) return false;

  const agentGkSessionId = agentData.gkSessionId || gkSessionId;
  session.agents = session.agents || [];

  const existingIndex = session.agents.findIndex(a => a.gkSessionId === agentGkSessionId);

  if (existingIndex >= 0) {
    const existing = session.agents[existingIndex];
    session.agents[existingIndex] = {
      ...existing,
      model: existing.model || agentData.model || null,
      prompt: existing.prompt || agentData.prompt || null
    };
  } else {
    const agent: GkAgent = {
      gkSessionId: agentGkSessionId,
      pid: agentData.pid || null,
      geminiSessionId: agentData.geminiSessionId || null,
      geminiProjectHash: agentData.geminiProjectHash || null,
      parentGkSessionId: agentData.parentGkSessionId || null,
      agentType: agentData.parentGkSessionId ? 'Sub Agent' : 'Main Agent',
      agentRole: agentData.agentRole || 'main',
      prompt: agentData.prompt || null,
      model: agentData.model || null,
      tokenUsage: agentData.tokenUsage || null,
      retryCount: agentData.retryCount || 0,
      resumeCount: agentData.resumeCount || 0,
      generation: agentData.generation || 0,
      injected: agentData.injected || null,
      startTime: new Date().toISOString(),
      endTime: null,
      status: 'active',
      exitCode: null,
      error: null
    };
    session.agents.push(agent);
  }

  return saveSession(projectDir, gkSessionId, session);
}

/**
 * Initialize a non-Gemini session
 * Matches gk-session-manager.cjs initializeNonGeminiSession()
 */
export function initializeNonGeminiSession(appName: string, options: {
  cwd?: string;
  activePlan?: string | null;
  suggestedPlan?: string | null;
} = {}): {
  session: GkSession;
  gkSessionId: string;
  pid: number;
  projectDir: string;
  gkProjectHash: string;
} {
  const cwd = options.cwd || process.cwd();
  const projectDir = sanitizeProjectPath(cwd);
  const gkProjectHash = generateProjectHash(cwd);

  // Use terminal PID for non-Gemini sessions
  const pid = getTerminalPid();
  const gkSessionId = generateGkSessionId(appName, pid);

  const session: GkSession = {
    // GemKit identification
    gkSessionId: gkSessionId,
    gkProjectHash: gkProjectHash,
    projectDir: projectDir,

    // No Gemini mapping for non-Gemini sessions
    geminiSessionId: null,
    geminiParentId: null,
    geminiProjectHash: null,

    // Session metadata
    initialized: true,
    initTimestamp: new Date().toISOString(),
    sessionType: 'non-gemini',
    appName: appName,
    pid: pid,

    // Plan management
    activePlan: options.activePlan || null,
    suggestedPlan: options.suggestedPlan || null,

    // Agents array
    agents: []
  };

  // Save session
  ensureDir(getProjectDataDir(projectDir));
  saveSession(projectDir, gkSessionId, session);

  // Update project
  ensureProject(projectDir, gkProjectHash, cwd);
  addSessionToProject(projectDir, gkProjectHash, {
    gkSessionId: gkSessionId,
    pid: pid,
    sessionType: 'non-gemini',
    appName: appName,
    startTime: session.initTimestamp,
    activePlan: session.activePlan
  });

  // Update env - CLEAR Gemini session ID for non-Gemini apps
  const existingEnv = readEnv();

  // Only preserve geminiProjectHash if we're in the SAME project
  const isSameProject = existingEnv.PROJECT_DIR === projectDir;
  const preservedGeminiProjectHash = isSameProject ? (existingEnv.GEMINI_PROJECT_HASH || '') : '';

  updateEnv({
    gkSessionId: gkSessionId,
    gkProjectHash: gkProjectHash,
    projectDir: projectDir,
    geminiSessionId: '',  // Clear - no Gemini session for non-Gemini apps
    geminiProjectHash: preservedGeminiProjectHash,
    activePlan: session.activePlan || '',
    suggestedPlan: session.suggestedPlan || '',
    planDateFormat: ''
  });

  return {
    session,
    gkSessionId,
    pid,
    projectDir,
    gkProjectHash
  };
}

/**
 * Set active plan in session and .env
 * Matches gk-session-manager.cjs setActivePlan()
 */
export function setActivePlan(projectDir: string, gkSessionId: string, planPath: string): boolean {
  const session = getSession(projectDir, gkSessionId);
  if (!session) return false;

  // Update session
  session.activePlan = planPath;
  session.suggestedPlan = null;
  if (!saveSession(projectDir, gkSessionId, session)) {
    return false;
  }

  // Update env - preserve existing values
  const env = readEnv();
  return updateEnv({
    gkSessionId: gkSessionId,
    gkProjectHash: session.gkProjectHash || env.GK_PROJECT_HASH,
    projectDir: projectDir,
    geminiSessionId: session.geminiSessionId || env.ACTIVE_GEMINI_SESSION_ID,
    geminiProjectHash: session.geminiProjectHash || env.GEMINI_PROJECT_HASH,
    activePlan: planPath,
    suggestedPlan: '',
    planDateFormat: session.planDateFormat || env.PLAN_DATE_FORMAT
  });
}

/**
 * Parse gkSessionId to extract components
 * Matches gk-session-manager.cjs parseGkSessionId()
 */
export function parseGkSessionId(gkSessionId: string): {
  appName: string;
  pid: number;
  timestamp: string;
  random: string;
} | null {
  if (!gkSessionId) return null;

  // Format: {appName}-{PID}-{ts36}-{rand4}
  const match = gkSessionId.match(/^(.+)-(\d+)-([a-z0-9]+)-([a-z0-9]{4})$/);
  if (!match) return null;

  return {
    appName: match[1],
    pid: parseInt(match[2], 10),
    timestamp: match[3],
    random: match[4]
  };
}
