/**
 * Session command - status, list, info, agents, init
 * Replaces: gk-init.cjs (init subcommand)
 *
 * Subcommands organized with custom help display.
 */

import type { CAC } from 'cac';
import {
  getActiveSession,
  getSession,
  listSessions,
  getAgents,
  getMetrics,
  getActiveGkSessionId,
  getProjectDir,
  readEnv,
  initializeNonGeminiSession,
  addAgent,
  parseGkSessionId,
  getTerminalPid
} from '../../domains/session/index.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';

// ═══════════════════════════════════════════════════════════════════════════
// HELP FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function showMainHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('Session Management')));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk session')} <subcommand> [options]`);
  console.log();
  console.log('Subcommands:');
  console.log(`  ${brand.primary('status')}            Show active session (default)`);
  console.log(`  ${brand.primary('list')}              List recent sessions`);
  console.log(`  ${brand.primary('info')} <id>         Show session details`);
  console.log(`  ${brand.primary('agents')} [id]       List agents in session`);
  console.log(`  ${brand.primary('init')} [app]        Initialize new session`);
  console.log();
  console.log('Options:');
  console.log(`  ${brand.dim('--json')}            Output as JSON`);
  console.log(`  ${brand.dim('-n, --limit <n>')}   Number of results for list (default: 10)`);
  console.log();
  console.log('Examples:');
  console.log(`  ${brand.dim('gk session status')}`);
  console.log(`  ${brand.dim('gk session list -n 20')}`);
  console.log(`  ${brand.dim('gk session info abc123')}`);
  console.log(`  ${brand.dim('gk session agents')}`);
  console.log(`  ${brand.dim('gk session init myapp')}`);
  console.log();
}

export function registerSessionCommand(cli: CAC): void {
  cli
    .command('session [subcommand] [id]', 'Session management (status, list, info, agents, init)')
    .alias('s')
    .option('--json', '[all] Output as JSON')
    .option('-n, --limit <n>', '[list] Number of results', { default: 10 })
    .action(async (subcommand: string | undefined, id: string | undefined, options: { json?: boolean; limit: number }) => {
      const sub = subcommand || 'status';

      switch (sub) {
        case 'status':
          await handleStatus(options);
          break;
        case 'list':
          await handleList(options);
          break;
        case 'info':
          if (!id) {
            console.log();
            logger.error('Session ID required');
            console.log(brand.dim('Usage: gk session info <id>'));
            console.log();
            process.exit(1);
          }
          await handleInfo(id, options);
          break;
        case 'agents':
          await handleAgents(id, options);
          break;
        case 'init':
          await handleInit(id || 'app', options);
          break;
        default:
          showMainHelp();
      }
    });
}

async function handleStatus(options: { json?: boolean }) {
  const env = readEnv();
  const projectDir = getProjectDir();
  const gkSessionId = env.ACTIVE_GK_SESSION_ID;

  if (!gkSessionId) {
    if (options.json) {
      console.log(JSON.stringify({ active: false, projectDir }, null, 2));
    } else {
      console.log();
      logger.info('No active GemKit session.');
      console.log(brand.dim(`  Project: ${projectDir}`));
      console.log();
    }
    return;
  }

  const session = getSession(projectDir, gkSessionId);

  if (options.json) {
    console.log(JSON.stringify(session || { active: false, gkSessionId }, null, 2));
    return;
  }

  if (!session) {
    console.log();
    logger.warn(`Session ID in .env but file not found: ${gkSessionId}`);
    console.log(brand.dim(`  Project: ${projectDir}`));
    console.log();
    return;
  }

  const metrics = getMetrics(projectDir, gkSessionId);
  const mainAgent = session.agents?.find(a => a.agentType === 'Main Agent');
  const status = mainAgent?.status || 'active';

  console.log();
  console.log(pc.bold(brand.geminiPurple('Active Session')));
  console.log(ui.line());
  console.log();
  console.log(`  ${brand.dim('GK Session ID:')}     ${brand.primary(session.gkSessionId)}`);
  console.log(`  ${brand.dim('Gemini Session ID:')} ${session.geminiSessionId || brand.dim('N/A')}`);
  console.log(`  ${brand.dim('Project Dir:')}       ${session.projectDir}`);
  console.log(`  ${brand.dim('App Name:')}          ${session.appName}`);
  console.log(`  ${brand.dim('PID:')}               ${session.pid}`);
  console.log(`  ${brand.dim('Status:')}            ${ui.statusIcon(status)} ${status}`);
  console.log(`  ${brand.dim('Started:')}           ${session.initTimestamp}`);
  if (session.activePlan) {
    console.log(`  ${brand.dim('Active Plan:')}       ${brand.primary(session.activePlan)}`);
  }
  console.log();
  console.log(`  ${brand.dim('Agents:')} ${metrics.total} total (${metrics.mainAgents} main, ${metrics.subAgents} sub)`);
  console.log(`          ${brand.success(String(metrics.completed))} completed, ${brand.error(String(metrics.failed))} failed, ${metrics.active} active`);
  console.log();
}

async function handleList(options: { json?: boolean; limit: number }) {
  const projectDir = getProjectDir();
  const sessions = listSessions(projectDir, { limit: options.limit });

  if (options.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  console.log();
  console.log(pc.bold(brand.geminiPurple('Recent Sessions')));
  console.log(brand.dim(`  Project: ${projectDir}`));
  console.log();

  if (sessions.length === 0) {
    logger.info('  No sessions found.');
    console.log();
    return;
  }

  for (const s of sessions) {
    const date = new Date(s.initTimestamp).toLocaleString();
    const mainAgent = s.agents?.find(a => a.agentType === 'Main Agent');
    const status = mainAgent?.status || 'active';
    const shortId = s.gkSessionId.length > 25 ? s.gkSessionId.slice(0, 25) + '...' : s.gkSessionId;
    console.log(`  ${ui.statusIcon(status)} ${brand.primary(shortId)}  ${brand.dim(date)}`);
    if (s.activePlan) {
      console.log(`    ${brand.dim('Plan:')} ${s.activePlan}`);
    }
  }
  console.log();
  console.log(brand.dim(`  Showing ${sessions.length} sessions (limit: ${options.limit})`));
  console.log();
}

async function handleInfo(id: string, options: { json?: boolean }) {
  const projectDir = getProjectDir();
  const session = getSession(projectDir, id);

  if (!session) {
    console.log();
    logger.error(`Session not found: ${id}`);
    console.log(brand.dim(`  Looked in: ~/.gemkit/projects/${projectDir}/`));
    console.log();
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  console.log();
  console.log(pc.bold(brand.geminiPurple(`Session: ${session.gkSessionId}`)));
  console.log(ui.line());
  console.log();
  console.log(JSON.stringify(session, null, 2));
  console.log();
}

async function handleAgents(id: string | undefined, options: { json?: boolean }) {
  const projectDir = getProjectDir();
  const sessionId = id || getActiveGkSessionId();

  if (!sessionId) {
    console.log();
    logger.error('No session ID provided and no active session found.');
    console.log();
    process.exit(1);
  }

  const session = getSession(projectDir, sessionId);
  if (!session) {
    console.log();
    logger.error(`Session not found: ${sessionId}`);
    console.log();
    process.exit(1);
  }

  const agents = session.agents || [];

  if (options.json) {
    console.log(JSON.stringify(agents, null, 2));
    return;
  }

  const shortId = sessionId.length > 30 ? sessionId.slice(0, 30) + '...' : sessionId;
  console.log();
  console.log(pc.bold(brand.geminiPurple(`Agents in Session`)));
  console.log(brand.dim(`  ${shortId}`));
  console.log();

  if (agents.length === 0) {
    logger.info('  No agents in this session.');
    console.log();
    return;
  }

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    const role = a.agentRole || 'unknown';
    const model = a.model || 'default';
    const type = a.agentType === 'Main Agent' ? brand.primary('MAIN') : brand.dim('SUB');

    console.log(`  ${ui.statusIcon(a.status)} [${type}] ${brand.primary(role)} ${brand.dim(`(${model})`)}`);

    if (a.prompt) {
      const shortPrompt = a.prompt.length > 60 ? a.prompt.slice(0, 60) + '...' : a.prompt;
      console.log(`    ${brand.dim('Prompt:')} ${shortPrompt}`);
    }

    if (a.tokenUsage) {
      console.log(`    ${brand.dim('Tokens:')} ${a.tokenUsage.total.toLocaleString()} total`);
    }

    if (a.geminiSessionId) {
      console.log(`    ${brand.dim('Gemini ID:')} ${a.geminiSessionId.slice(0, 8)}...`);
    }
  }

  console.log();
  console.log(brand.dim(`  Total: ${agents.length} agents`));
  console.log();
}

/**
 * Handle session init - Initialize a non-Gemini GemKit session
 * Replaces: gk-init.cjs
 */
async function handleInit(appName: string, options: { json?: boolean }) {
  const env = readEnv();
  const existingSessionId = env.ACTIVE_GK_SESSION_ID;

  if (existingSessionId) {
    // Parse PID from existing session ID
    const parsed = parseGkSessionId(existingSessionId);
    const projectDir = getProjectDir();

    if (parsed) {
      // Get current terminal PID to compare
      const currentTerminalPid = getTerminalPid();

      // Check if session exists and has same PID (same terminal)
      const existingSession = getSession(projectDir, existingSessionId);

      if (existingSession && parsed.pid === currentTerminalPid) {
        // Session already exists for this terminal
        if (options.json) {
          console.log(JSON.stringify({
            status: 'existing',
            gkSessionId: existingSessionId,
            pid: parsed.pid
          }, null, 2));
        } else {
          console.log();
          logger.info(`GemKit session already active: ${brand.primary(existingSessionId.slice(0, 30) + '...')}`);
          console.log(brand.dim(`  PID: ${parsed.pid}`));
          console.log();
        }
        return;
      }
    }
  }

  // Initialize new non-Gemini session
  const { session, gkSessionId, pid, projectDir } = initializeNonGeminiSession(appName);

  // Add main agent entry to session
  addAgent(projectDir, gkSessionId, {
    gkSessionId: gkSessionId,
    pid: pid,
    geminiSessionId: null,
    parentGkSessionId: null,
    agentRole: 'main',
    prompt: null,
    model: null
  });

  if (options.json) {
    console.log(JSON.stringify({
      status: 'initialized',
      gkSessionId: gkSessionId,
      pid: pid,
      projectDir: projectDir
    }, null, 2));
  } else {
    console.log();
    logger.success(`GemKit session initialized: ${brand.primary(gkSessionId.slice(0, 30) + '...')}`);
    console.log(brand.dim(`  PID: ${pid}`));
    console.log();
  }
}
