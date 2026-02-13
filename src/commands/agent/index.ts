/**
 * Agent command - list, info, search, spawn (NO resume)
 * Spawn aligned with .gemini/extensions/spawn-agent/scripts/gemini_agent.js
 *
 * Uses manual subcommand routing since CAC doesn't support space-separated subcommands.
 * Help is customized to show subcommand-specific options.
 */

import type { CAC } from 'cac';
import { spawn, fork } from 'child_process';
import { access, stat, readdir, readFile } from 'fs/promises';
import { join, basename, extname, relative } from 'path';
import { fileURLToPath } from 'url';
import {
  listAgentProfiles,
  loadAgentProfile,
  formatAgentProfile,
  loadAgentProfileWithFallback,
  listAgentProfilesWithFallback
} from '../../domains/agent/profile.js';
import { searchAgentSkillCombination, loadSkillContent } from '../../domains/agent/search.js';
import { mapModel, mapTools, getDefaultModel } from '../../domains/agent/mappings.js';
import type { CliProvider } from '../../domains/agent/types.js';
import type { PtySessionState, LoadedContext } from '../../domains/agent/pty-types.js';
import {
  loadSession,
  saveSession,
  clearSession,
  isSessionActive,
  markFirstSendComplete
} from '../../domains/agent/pty-session.js';
import { buildFirstSendPrompt } from '../../domains/agent/pty-context.js';
import { PtyClient } from '../../services/pty-client.js';
import { PtyServer } from '../../services/pty-server.js';
import { loadConfig } from '../../domains/config/manager.js';
import { readEnv } from '../../domains/session/env.js';
import { addAgent } from '../../domains/session/writer.js';
import { generateGkSessionId } from '../../services/hash.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';
import { ElevatorMusic } from '../../services/music.js';
import { sanitizeProjectPath } from '../../utils/paths.js';
import {
  getTeam,
  allocatePort,
  releasePort,
  addMemberToTeam,
  updateMemberStatus
} from '../../domains/team/index.js';

// ============================================================================
// HEARTBEAT MESSAGES (keeps shell alive & entertains)
// ============================================================================
const HEARTBEAT_MESSAGES = [
  { icon: '💩', action: 'Pooping out some code' },
  { icon: '🍳', action: 'Cooking up solutions' },
  { icon: '🧠', action: 'Brain cells working overtime' },
  { icon: '⚡', action: 'Neurons firing rapidly' },
  { icon: '🔮', action: 'Consulting the crystal ball' },
  { icon: '🎰', action: 'Rolling the dice on this one' },
  { icon: '🚀', action: 'Launching into hyperthink' },
  { icon: '🌪️', action: 'Brainstorming intensifies' },
  { icon: '🎪', action: 'Juggling multiple thoughts' },
  { icon: '🔧', action: 'Tightening the logic bolts' },
  { icon: '🎨', action: 'Painting the solution' },
  { icon: '🏗️', action: 'Building something awesome' },
  { icon: '🔬', action: 'Analyzing under the microscope' },
  { icon: '🧪', action: 'Mixing the secret sauce' },
  { icon: '🎯', action: 'Aiming for perfection' },
  { icon: '🧙', action: 'Casting coding spells' },
  { icon: '🐙', action: 'Multitasking like an octopus' },
  { icon: '🦾', action: 'Flexing the AI muscles' },
  { icon: '🌈', action: 'Finding the pot of gold' },
  { icon: '🎸', action: 'Rocking out some logic' }
];

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Start heartbeat to keep shell alive
 */
function startHeartbeat(agentName: string): { stop: () => void; interval: NodeJS.Timeout } {
  let messageIndex = 0;
  let spinnerIndex = 0;
  let seconds = 0;
  const isTTY = process.stdout.isTTY;

  const interval = setInterval(() => {
    seconds++;
    spinnerIndex++;

    const messageChanged = seconds % 10 === 0;
    if (messageChanged) {
      messageIndex++;
    }

    const msg = HEARTBEAT_MESSAGES[messageIndex % HEARTBEAT_MESSAGES.length];
    const spinner = SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length];
    const line = `${spinner} ${msg.icon} ${msg.action}... ${seconds}s`;

    if (isTTY) {
      process.stdout.write(`\r\x1b[K${line}`);
    } else {
      if (seconds === 1 || messageChanged) {
        console.log(line);
      }
    }
  }, 1000);

  return {
    interval,
    stop: () => {
      clearInterval(interval);
      if (isTTY) {
        process.stdout.write('\r\x1b[K');
      }
    }
  };
}

/**
 * Build subagent context string for prompt injection
 */
function buildSubagentContext(options: {
  agentType?: string;
  agentRole?: string;
  parentSessionId?: string | null;
  activePlan?: string | null;
  projectDir?: string | null;
}): string {
  const {
    agentType = 'Sub Agent',
    agentRole = 'unknown',
    parentSessionId = null,
    activePlan = null,
    projectDir = null
  } = options;

  const lines = [
    `Agent Type: ${agentType}`,
    `Agent Role: ${agentRole}`,
  ];

  if (parentSessionId) {
    lines.push(`Parent Session: ${parentSessionId.slice(0, 8)}...`);
  }

  if (projectDir) {
    lines.push(`Project: ${projectDir}`);
  }

  if (activePlan) {
    lines.push(`Active Plan: ${activePlan}`);
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// HELP FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function showMainHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('Agent Management')));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk agent')} <subcommand> [options]`);
  console.log();
  console.log('Subcommands:');
  console.log(`  ${brand.primary('list')}              List all agent profiles`);
  console.log(`  ${brand.primary('info')} <name>       Show agent profile details`);
  console.log(`  ${brand.primary('search')} "<task>"   Find best agent+skills for a task`);
  console.log(`  ${brand.primary('spawn')}             Spawn a sub-agent (non-interactive)`);
  console.log();
  console.log('Interactive Mode:');
  console.log(`  ${brand.primary('start')}             Start interactive session`);
  console.log(`  ${brand.primary('send')} "<prompt>"   Send prompt to session`);
  console.log(`  ${brand.primary('wait')} [timeout]    Wait for completion`);
  console.log(`  ${brand.primary('exchange')}          Get structured output`);
  console.log(`  ${brand.primary('pending')}           Check tool confirmations`);
  console.log(`  ${brand.primary('read')} [lines]      Read raw output`);
  console.log(`  ${brand.primary('status')}            Session status`);
  console.log(`  ${brand.primary('stop')}              Stop session`);
  console.log();
  console.log('Examples:');
  console.log(`  ${brand.dim('gk agent list')}`);
  console.log(`  ${brand.dim('gk agent spawn -a researcher -p "research best practices"')}`);
  console.log(`  ${brand.dim('gk agent start -a researcher -s research')}`);
  console.log(`  ${brand.dim('gk agent send "analyze the codebase"')}`);
  console.log();
  console.log('Run with subcommand for specific help:');
  console.log(`  ${brand.dim('gk agent spawn --help')}`);
  console.log(`  ${brand.dim('gk agent start --help')}`);
  console.log();
}

function showListHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('gk agent list')));
  console.log(brand.dim('List all available agent profiles'));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk agent list')} [options]`);
  console.log();
  console.log('Options:');
  console.log(`  ${brand.dim('--json')}    Output as JSON`);
  console.log();
}

function showInfoHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('gk agent info')));
  console.log(brand.dim('Show detailed information about an agent profile'));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk agent info')} <name> [options]`);
  console.log();
  console.log('Arguments:');
  console.log(`  ${brand.dim('<name>')}    Agent profile name (without .md extension)`);
  console.log();
  console.log('Options:');
  console.log(`  ${brand.dim('--json')}    Output as JSON`);
  console.log();
  console.log('Example:');
  console.log(`  ${brand.dim('gk agent info researcher')}`);
  console.log();
}

function showSearchHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('gk agent search')));
  console.log(brand.dim('Find best agent+skills combination for a task using BM25 search'));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk agent search')} "<task>" [options]`);
  console.log();
  console.log('Arguments:');
  console.log(`  ${brand.dim('<task>')}              Task description to search for`);
  console.log();
  console.log('Options:');
  console.log(`  ${brand.dim('-n, --limit <n>')}     Number of results (default: 5)`);
  console.log(`  ${brand.dim('-i, --intent <i>')}    Force intent: research|plan|execute|debug|review|test|design|docs`);
  console.log(`  ${brand.dim('-d, --domain <d>')}    Force domain: frontend|backend|auth|payment|database|mobile|ai|etc.`);
  console.log(`  ${brand.dim('--max-skills <n>')}    Maximum skills to include`);
  console.log(`  ${brand.dim('--json')}              Output as JSON`);
  console.log();
  console.log('Examples:');
  console.log(`  ${brand.dim('gk agent search "implement user authentication"')}`);
  console.log(`  ${brand.dim('gk agent search "debug the login form" -i debug')}`);
  console.log(`  ${brand.dim('gk agent search "build a payment page" -d payment')}`);
  console.log();
}

function showSpawnHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('gk agent spawn')));
  console.log(brand.dim('Spawn a sub-agent with Gemini or Claude CLI'));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk agent spawn')} -p "<prompt>" [options]`);
  console.log();
  console.log('Required:');
  console.log(`  ${brand.dim('-p, --prompt <text>')}     Task prompt for the agent`);
  console.log();
  console.log('Options:');
  console.log(`  ${brand.dim('-a, --agent <name>')}      Agent profile name`);
  console.log(`  ${brand.dim('-s, --skills <list>')}     Comma-separated skill names to inject`);
  console.log(`  ${brand.dim('-c, --context <files>')}   Context files (@file syntax)`);
  console.log(`  ${brand.dim('-m, --model <model>')}     Model override (default: from config)`);
  console.log(`  ${brand.dim('-t, --tools <list>')}      Comma-separated tools to auto-approve`);
  console.log(`  ${brand.dim('--cli <provider>')}        CLI provider: gemini (default) or claude`);
  console.log(`  ${brand.dim('--music')}                 Play elevator music while waiting`);
  console.log(`  ${brand.dim('--no-music')}              Disable elevator music`);
  console.log(`  ${brand.dim('--music-file <path>')}     Custom music file path`);
  console.log();
  console.log('CLI Providers:');
  console.log(`  ${brand.dim('gemini')}   Uses Gemini CLI (default). Loads from .gemini/agents/, falls back to .claude/agents/`);
  console.log(`  ${brand.dim('claude')}   Uses Claude CLI. Loads from .claude/agents/, falls back to .gemini/agents/`);
  console.log(`  ${brand.dim('Models and tools are automatically mapped between providers when using fallback.')}`);
  console.log();
  console.log('Examples:');
  console.log(`  ${brand.dim('gk agent spawn -p "fix the login bug"')}`);
  console.log(`  ${brand.dim('gk agent spawn -a researcher -p "research React best practices"')}`);
  console.log(`  ${brand.dim('gk agent spawn -a code-executor -s "frontend-design" -p "build a dashboard"')}`);
  console.log(`  ${brand.dim('gk agent spawn -p "implement auth" -m gemini-2.5-pro --music')}`);
  console.log(`  ${brand.dim('gk agent spawn -a researcher -t "list_directory,read_file,glob" -p "analyze code"')}`);
  console.log(`  ${brand.dim('gk agent spawn --cli claude -a researcher -p "analyze codebase"')}`);
  console.log();
  console.log('Allowed Tools:');
  console.log(`  ${brand.dim('Tools can be defined in agent frontmatter (tools: tool1, tool2)')}`);
  console.log(`  ${brand.dim('or passed via CLI. Both sources are merged and deduplicated.')}`);
  console.log(`  ${brand.dim('Gemini tools: list_directory, read_file, write_file, glob, run_shell_command(*)')}`);
  console.log(`  ${brand.dim('Claude tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch')}`);
  console.log();
}

function showStartHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('gk agent start')));
  console.log(brand.dim('Start a single interactive AI session'));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk agent start')} [options]`);
  console.log();
  console.log('Options:');
  console.log(`  ${brand.dim('-a, --agent <name>')}      Agent profile name`);
  console.log(`  ${brand.dim('-s, --skills <list>')}     Comma-separated skill names`);
  console.log(`  ${brand.dim('-c, --context <files>')}   Context files (@file syntax)`);
  console.log(`  ${brand.dim('-m, --model <model>')}     Model override`);
  console.log(`  ${brand.dim('-t, --tools <list>')}      Comma-separated tools to allow`);
  console.log(`  ${brand.dim('--cli <provider>')}        CLI provider: gemini (default) or claude`);
  console.log();
  console.log('Examples:');
  console.log(`  ${brand.dim('gk agent start -a researcher -s research')}`);
  console.log(`  ${brand.dim('gk agent start --cli claude -a code-executor')}`);
  console.log(`  ${brand.dim('gk agent start -m gemini-2.5-pro -t "read_file,write_file"')}`);
  console.log();
  console.log('After starting:');
  console.log(`  ${brand.dim('gk agent send "your prompt"')}`);
  console.log(`  ${brand.dim('gk agent wait')}`);
  console.log(`  ${brand.dim('gk agent exchange')}`);
  console.log(`  ${brand.dim('gk agent stop')}`);
  console.log();
  console.log('For team mode, use: gk team start --name <agent>');
  console.log();
}

function showInteractiveHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('Interactive Mode Commands')));
  console.log();
  console.log('Session:');
  console.log(`  ${brand.primary('start')} [options]    Start interactive session`);
  console.log(`  ${brand.primary('stop')}              Stop interactive session`);
  console.log(`  ${brand.primary('status')}            Check session status`);
  console.log();
  console.log('Interaction:');
  console.log(`  ${brand.primary('send')} "<prompt>"   Send prompt to session`);
  console.log(`  ${brand.primary('wait')} [timeout]    Wait for response completion`);
  console.log(`  ${brand.primary('exchange')}          Get structured JSON output`);
  console.log(`  ${brand.primary('pending')}           Check pending tool confirmations`);
  console.log(`  ${brand.primary('read')} [lines]      Read raw output (debugging)`);
  console.log();
  console.log('Examples:');
  console.log(`  ${brand.dim('gk agent start -a researcher -s research')}`);
  console.log(`  ${brand.dim('gk agent send "research JWT best practices"')}`);
  console.log(`  ${brand.dim('gk agent wait')}`);
  console.log(`  ${brand.dim('gk agent pending')}`);
  console.log(`  ${brand.dim('gk agent send "1"')}  ${brand.dim('# approve tool')}`);
  console.log(`  ${brand.dim('gk agent exchange')}`);
  console.log(`  ${brand.dim('gk agent stop')}`);
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

export function registerAgentCommand(cli: CAC): void {
  cli
    .command('agent [subcommand] [arg]', 'Agent management (list, info, search, spawn)')
    .alias('a')
    // Shared
    .option('--json', '[all] Output as JSON')
    // Search options
    .option('-n, --limit <n>', '[search] Number of results (default: 5)', { default: 5 })
    .option('-i, --intent <intent>', '[search] Force intent: research|plan|execute|debug|review|test|design|docs')
    .option('-d, --domain <domain>', '[search] Force domain: frontend|backend|auth|payment|database|mobile|ai')
    .option('--max-skills <n>', '[search] Maximum skills to include')
    // Spawn options
    .option('-a, --agent <name>', '[spawn] Agent profile name')
    .option('-p, --prompt <text>', '[spawn] Task prompt (required for spawn)')
    .option('-s, --skills <list>', '[spawn] Comma-separated skill names')
    .option('-c, --context <files>', '[spawn] Context files (@file syntax)')
    .option('-m, --model <model>', '[spawn] Model override')
    .option('-t, --tools <list>', '[spawn] Comma-separated tools to auto-approve')
    .option('--cli <provider>', '[spawn] CLI provider: gemini (default) or claude')
    .option('--music', '[spawn] Play elevator music while waiting')
    .option('--no-music', '[spawn] Disable elevator music')
    .option('--music-file <path>', '[spawn] Custom music file path')
    .action(async (subcommand: string | undefined, arg: string | undefined, options: any) => {
      // Handle help for subcommands
      if (options.help || options.h) {
        switch (subcommand) {
          case 'list':
            showListHelp();
            return;
          case 'info':
            showInfoHelp();
            return;
          case 'search':
            showSearchHelp();
            return;
          case 'spawn':
            showSpawnHelp();
            return;
          case 'start':
            showStartHelp();
            return;
          case 'send':
          case 'wait':
          case 'exchange':
          case 'pending':
          case 'read':
          case 'status':
          case 'stop':
            showInteractiveHelp();
            return;
          default:
            showMainHelp();
            return;
        }
      }

      // Route to subcommand handlers
      switch (subcommand) {
        case 'list':
          await handleList(options);
          break;
        case 'info':
          if (!arg) {
            console.log();
            logger.error('Agent profile name required');
            console.log(brand.dim('Usage: gk agent info <name>'));
            console.log();
            process.exit(1);
          }
          await handleInfo(arg, options);
          break;
        case 'search':
          if (!arg) {
            console.log();
            logger.error('Search query required');
            console.log(brand.dim('Usage: gk agent search "<task>"'));
            console.log();
            process.exit(1);
          }
          await handleSearch(arg, options);
          break;
        case 'spawn':
          await handleSpawn(options);
          break;
        // Interactive mode commands
        case 'start':
          await handleStart(options);
          break;
        case 'send':
          if (!arg) {
            console.log();
            logger.error('Prompt required');
            console.log(brand.dim('Usage: gk agent send "your prompt"'));
            console.log();
            process.exit(1);
          }
          await handleSend(arg);
          break;
        case 'wait':
          await handleWait(arg ? parseInt(arg) : 120);
          break;
        case 'exchange':
          await handleExchange();
          break;
        case 'pending':
          await handlePending();
          break;
        case 'read':
          await handleRead(arg ? parseInt(arg) : 200);
          break;
        case 'status':
          await handleInteractiveStatus();
          break;
        case 'stop':
          await handleStop();
          break;
        case '_server':
          // Hidden command: runs server in background (spawned by start)
          await handleServerInternal();
          break;
        default:
          showMainHelp();
      }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleList(options: { json?: boolean }) {
  const profiles = listAgentProfiles();

  if (options.json) {
    console.log(JSON.stringify(profiles, null, 2));
    return;
  }

  console.log();
  console.log(pc.bold(brand.geminiPurple('Available Agents')));
  console.log();

  if (profiles.length === 0) {
    logger.warn('No agent profiles found. Run "gk init" first.');
    console.log();
    return;
  }

  for (const profile of profiles) {
    console.log(`  ${brand.primary(profile.name)}`);
    console.log(`    ${brand.dim(profile.description)}`);
    console.log(`    ${brand.dim('Model:')}  ${profile.model}`);
    if (profile.skills && profile.skills.length > 0) {
      console.log(`    ${brand.dim('Skills:')} ${profile.skills.join(', ')}`);
    }
    console.log('');
  }
  console.log(brand.dim(`  Total: ${profiles.length} agents`));
  console.log();
}

async function handleInfo(name: string, options: { json?: boolean }) {
  const profile = loadAgentProfile(name);

  if (!profile) {
    console.log();
    logger.error(`Agent profile not found: ${name}`);
    console.log();
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(profile, null, 2));
    return;
  }

  console.log();
  console.log(ui.doubleLine());
  console.log(pc.bold(brand.geminiPurple(`Agent: ${profile.name}`)));
  console.log(ui.doubleLine());
  console.log();
  console.log(`  ${brand.dim('Description:')} ${profile.description}`);
  console.log(`  ${brand.dim('Model:')}       ${profile.model}`);
  if (profile.skills?.length) {
    console.log(`  ${brand.dim('Skills:')}      ${profile.skills.join(', ')}`);
  }
  console.log(`  ${brand.dim('Path:')}        ${profile.filePath}`);

  console.log();
  console.log(brand.dim('--- Profile Content ---'));
  console.log();
  console.log(brand.dim(profile.content));
  console.log();
}

async function handleSearch(task: string, options: {
  limit: number;
  json?: boolean;
  intent?: string;
  domain?: string;
  maxSkills?: number;
}) {
  const results = searchAgentSkillCombination(task, {
    top: options.limit,
    forceIntent: options.intent as any,
    forceDomain: options.domain as any,
    maxSkills: options.maxSkills,
  });

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log();
  console.log(pc.bold(brand.geminiPurple(`Search results for: "${task}"`)));
  console.log();

  if (results.length === 0) {
    logger.warn('No matching agents found for task.');
    console.log();
    return;
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const fallbackTag = r.fallback ? brand.warn(' [FALLBACK]') : '';

    console.log(`  ${brand.success(i + 1 + '.')} ${brand.primary(r.agent)}${fallbackTag} ${brand.dim(`(score: ${r.score})`)}`);
    console.log(`     ${brand.dim('Intent:')} ${r.intent}  ${brand.dim('Domain:')} ${r.domain}  ${brand.dim('Complexity:')} ${r.complexity}`);

    if (r.skills.length > 0) {
      console.log(`     ${brand.dim('Skills:')} ${r.skills.join(' | ')}`);
    }

    if (r.description) {
      console.log(`     ${brand.dim(r.description)}`);
    }

    if (r.useWhen) {
      console.log(`     ${brand.dim('Use when:')} ${r.useWhen}`);
    }

    console.log('');
  }

  // Show suggested command
  if (results.length > 0) {
    const best = results[0];
    const skillsArg = best.skills.length > 0 ? ` -s "${best.skills.join(',')}"` : '';
    console.log(brand.dim('  Suggested command:'));
    console.log(`    ${brand.primary('gk')} agent spawn -a ${best.agent}${skillsArg} -p "${task}"`);
  }
  console.log();
}

async function handleSpawn(options: {
  agent?: string;
  prompt?: string;
  skills?: string;
  context?: string;
  model?: string;
  tools?: string;
  cli?: string;
  music?: boolean;
  musicFile?: string;
  team?: string;
  name?: string;
}) {
  if (!options.prompt) {
    console.log();
    logger.error('Prompt is required. Use -p or --prompt');
    console.log();
    showSpawnHelp();
    process.exit(1);
  }

  // Parse and validate CLI provider
  const cliProvider: CliProvider = (options.cli === 'claude') ? 'claude' : 'gemini';

  const config = loadConfig();

  // Read .env for session info
  const env = readEnv();
  const parentGkSessionId = env.ACTIVE_GK_SESSION_ID || null;
  const parentGeminiSessionId = env.ACTIVE_GEMINI_SESSION_ID || null;
  const activePlan = env.ACTIVE_PLAN || null;
  const suggestedPlan = env.SUGGESTED_PLAN || null;
  const planDateFormat = env.PLAN_DATE_FORMAT || null;
  const projectDir = env.PROJECT_DIR || null;

  // Team context (if spawning as team member)
  let teamContext: {
    team: ReturnType<typeof getTeam>;
    port: number;
    memberName: string;
    sanitizedProjectDir: string;
  } | null = null;

  if (options.team) {
    const sanitizedProjectDir = sanitizeProjectPath(process.cwd());
    const team = getTeam(sanitizedProjectDir, options.team);

    if (!team) {
      console.log();
      logger.error(`Team not found: ${options.team}`);
      console.log();
      process.exit(1);
    }

    const memberName = options.name || options.agent || 'agent';

    // Allocate port for this team member
    const agentId = generateGkSessionId(`team-${memberName}`, process.pid);
    const port = allocatePort(sanitizedProjectDir, agentId, team.teamId, null);

    if (!port) {
      console.log();
      logger.error('No ports available for team member');
      console.log();
      process.exit(1);
    }

    teamContext = {
      team,
      port,
      memberName,
      sanitizedProjectDir
    };

    logger.info(`Spawning as team member: ${brand.primary(memberName)}`);
    logger.info(`Team: ${brand.dim(team.teamName)} (${team.teamId.slice(0, 12)}...)`);
    logger.info(`Port: ${brand.dim(port.toString())}`);
  }

  // Load agent profile if specified (with fallback between providers)
  let profile = null;
  if (options.agent) {
    profile = loadAgentProfileWithFallback(options.agent, cliProvider);
    if (!profile) {
      console.log();
      logger.error(`Agent profile not found: ${options.agent}`);
      console.log(brand.dim(`Searched: .${cliProvider === 'claude' ? 'claude' : 'gemini'}/agents/ and fallback folder`));
      console.log();
      process.exit(1);
    }
  }

  // Determine model (map to target provider if needed)
  let model = options.model || profile?.model || config.spawn.defaultModel;
  // Map model to target provider format
  model = mapModel(model, cliProvider);

  // Resolve music setting: CLI flag > config default
  // CAC sets options.music=true by default when --no-music is defined, so check argv explicitly
  const hasExplicitMusicFlag = process.argv.includes('--music') || process.argv.includes('--no-music');
  const musicEnabled = hasExplicitMusicFlag ? options.music : config.spawn.music;
  const musicFile = options.musicFile || config.spawn.musicFile;

  // Build skills list
  const cliSkills = options.skills?.split(',').map(s => s.trim()).filter(Boolean) || [];
  const agentSkills = profile?.skills || [];
  const allSkills = [...new Set([...agentSkills, ...cliSkills])];

  // Build tools list (merge agent profile tools with CLI tools, deduplicated)
  // Note: profile?.tools already mapped by loadAgentProfileWithFallback if from fallback path
  const cliTools = options.tools?.split(',').map(s => s.trim()).filter(Boolean) || [];
  const agentTools = profile?.tools || [];
  const mergedTools = [...new Set([...agentTools, ...cliTools])];
  // Map CLI tools to target provider (agentTools already mapped if from fallback)
  const allTools = mapTools(mergedTools, cliProvider);

  // LoadedContext type - aligned with gemini_agent.js context objects
  interface LoadedContext {
    type: 'context';
    name: string;
    path: string;
    content: string;
    originalRef: string;
    relativePath?: string;
  }

  // Build context list - aligned with gemini_agent.js
  // Parse context refs: split by comma, then by spaces, filter empty strings
  const contextRefs = options.context
    ? options.context.split(',').flatMap(part => part.trim().split(/\s+/).filter(s => s)).filter(s => s)
    : [];

  // loadContext - aligned with gemini_agent.js loadContext()
  async function loadContext(contextRef: string): Promise<LoadedContext | LoadedContext[]> {
    let fullPath = contextRef;
    let found = false;

    // Handle @ prefix references
    if (contextRef.startsWith('@')) {
      const relativePath = contextRef.substring(1);
      const searchPaths = [
        join(process.cwd(), '.docs', relativePath),
        join(process.cwd(), '.plans', relativePath),
        join(process.cwd(), 'docs', relativePath),
        join(process.cwd(), 'plans', relativePath),
        join(process.cwd(), relativePath)
      ];

      for (const searchPath of searchPaths) {
        try {
          await access(searchPath);
          fullPath = searchPath;
          found = true;
          break;
        } catch {
          continue;
        }
      }

      // If @ prefix file not found, show clear error with searched paths
      if (!found) {
        const pathsList = searchPaths.map(p => `  - ${p}`).join('\n');
        throw new Error(
          `Context file not found: ${contextRef}\n` +
          `Searched paths:\n${pathsList}\n` +
          `Tip: Place file in .docs/, .plans/, docs/, plans/, or project root`
        );
      }
    }

    try {
      // Check if path is a directory
      const fileStat = await stat(fullPath);

      if (fileStat.isDirectory()) {
        return await loadContextDirectory(fullPath, contextRef);
      }

      // It's a file - load it directly
      const content = await readFile(fullPath, 'utf-8');
      const fileName = basename(fullPath);

      return {
        type: 'context',
        name: fileName,
        path: fullPath,
        content: content.trim(),
        originalRef: contextRef
      };
    } catch (error) {
      throw new Error(`Failed to load context from ${contextRef}: ${(error as Error).message}`);
    }
  }

  // loadContextDirectory - aligned with gemini_agent.js loadContextDirectory()
  async function loadContextDirectory(dirPath: string, originalRef: string): Promise<LoadedContext[]> {
    const maxDepth = 3;
    const extensions = ['.md', '.txt', '.json', '.yaml', '.yml'];
    const contexts: LoadedContext[] = [];

    async function walkDir(currentPath: string, depth: number = 0): Promise<void> {
      if (depth > maxDepth) return;

      const entries = await readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = join(currentPath, entry.name);

        // Skip hidden files and directories
        if (entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
          await walkDir(entryPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            try {
              const content = await readFile(entryPath, 'utf-8');
              const relativePath = relative(dirPath, entryPath);

              contexts.push({
                type: 'context',
                name: entry.name,
                path: entryPath,
                relativePath: relativePath,
                content: content.trim(),
                originalRef: `${originalRef}/${relativePath}`
              });
            } catch (err) {
              console.warn(`Warning: Could not read ${entryPath}: ${(err as Error).message}`);
            }
          }
        }
      }
    }

    await walkDir(dirPath);

    // Sort by relative path for consistent ordering
    contexts.sort((a, b) => (a.relativePath || '').localeCompare(b.relativePath || ''));

    return contexts;
  }

  // formatContext - aligned with gemini_agent.js formatContext()
  function formatContext(contextItems: LoadedContext[]): string {
    if (!contextItems || contextItems.length === 0) {
      return '';
    }

    let contextSection = '<context>\n';
    contextSection += 'The following documents provide additional context for this task:\n\n';

    contextItems.forEach((ctx, index) => {
      contextSection += `## Document ${index + 1}: ${ctx.name}\n`;
      contextSection += `Source: ${ctx.originalRef}\n\n`;
    });

    contextSection += '</context>\n\n';

    return contextSection;
  }

  // Load context files/directories - aligned with gemini_agent.js buildAgentContext()
  const loadedContexts: LoadedContext[] = [];
  if (contextRefs && contextRefs.length > 0) {
    for (const ctx of contextRefs) {
      try {
        if (typeof ctx === 'string') {
          const loaded = await loadContext(ctx);
          // Handle both single file (object) and directory (array) results
          if (Array.isArray(loaded)) {
            loadedContexts.push(...loaded);
          } else {
            loadedContexts.push(loaded);
          }
        } else {
          loadedContexts.push(ctx);
        }
      } catch (error) {
        console.log();
        logger.error((error as Error).message);
        console.log();
        process.exit(1);
      }
    }
  }

  // Agent display name
  const agentDisplayName = profile?.name || options.agent || 'Sub';

  // Build enriched prompt
  const promptParts: string[] = [];

  // Add subagent context
  const subagentContext = buildSubagentContext({
    agentType: 'Sub Agent',
    agentRole: agentDisplayName,
    parentSessionId: parentGkSessionId,
    activePlan: activePlan,
    projectDir: projectDir
  });
  promptParts.push('<subagent-context>');
  promptParts.push(subagentContext);
  promptParts.push('</subagent-context>\n');
  
  // Add task/prompt
  promptParts.push('<task>');
  promptParts.push(options.prompt);
  promptParts.push('</task>\n');

  // Add agent profile content
  if (profile) {
    promptParts.push('<agent>');
    promptParts.push(`# Agent: ${profile.name}\n`);
    promptParts.push('## Role & Responsibilities');
    promptParts.push(profile.content);
    promptParts.push('</agent>\n');
  }

  // Add skills content
  if (allSkills.length > 0) {
    promptParts.push('<skills>');
    promptParts.push('You have access to the following skills and capabilities:\n');

    for (let i = 0; i < allSkills.length; i++) {
      const skill = allSkills[i];
      const skillContent = loadSkillContent(skill);
      if (skillContent) {
        promptParts.push(`## Skill ${i + 1}: ${skill}`);
        promptParts.push(skillContent);
        promptParts.push('---\n');
      }
    }
    promptParts.push('</skills>\n');
  }

  // Add context section - aligned with gemini_agent.js formatContext()
  if (loadedContexts.length > 0) {
    promptParts.push(formatContext(loadedContexts));
  }

  const enrichedPrompt = promptParts.join('\n');

  // Truncate prompt for env var (150 chars)
  const truncatedPrompt = options.prompt.length > 150
    ? options.prompt.substring(0, 150)
    : options.prompt;

  console.log();
  logger.info(`Spawning ${brand.primary(agentDisplayName)} agent with ${brand.primary(cliProvider)} CLI`);
  logger.info(`Model: ${brand.primary(model)}`);
  if (parentGkSessionId) {
    logger.info(`Parent session: ${brand.dim(parentGkSessionId.slice(0, 20) + '...')}`);
  }
  if (activePlan) {
    logger.info(`Active plan: ${brand.dim(activePlan)}`);
  }
  if (allSkills.length > 0) {
    logger.info(`Injected skills: ${brand.dim(allSkills.join(', '))}`);
  }
  if (loadedContexts.length > 0) {
    logger.info(`Injected context: ${brand.dim(loadedContexts.map(c => c.name).join(', '))}`);
  }
  if (allTools.length > 0) {
    logger.info(`Allowed tools: ${brand.dim(allTools.join(', '))}`);
  }
  console.log(ui.line());
  console.log();

  // Initialize elevator music if enabled
  let elevatorMusic: ElevatorMusic | null = null;
  if (musicEnabled) {
    elevatorMusic = new ElevatorMusic({
      audioFile: musicFile,
      loop: true,
      volume: 0.3
    });

    const started = elevatorMusic.start();
    if (started) {
      console.log(brand.dim('Playing elevator music while waiting...'));
      console.log();
    }
  }

  // Prepare injected info for tracking - aligned with gemini_agent.js line 911
  const injectedContext = loadedContexts.map(c => c.path || c.name);

  // Generate sub-agent session ID and add to session file IMMEDIATELY
  // This allows dashboard to show agent right when music starts
  // The ID is passed to hook via GK_SUB_SESSION_ID so hook updates same agent
  const subAgentSessionId = generateGkSessionId('gemini-sub', process.pid);
  if (parentGkSessionId && projectDir) {
    addAgent(projectDir, parentGkSessionId, {
      gkSessionId: subAgentSessionId,
      pid: process.pid,
      parentGkSessionId: parentGkSessionId,
      agentRole: agentDisplayName,
      prompt: options.prompt,
      model: model,
      injected: (allSkills.length > 0 || injectedContext.length > 0)
        ? { skills: allSkills, context: injectedContext }
        : null
    });
  }

  // Start heartbeat
  const heartbeat = startHeartbeat(agentDisplayName);

  // Build spawn args and command based on CLI provider
  let cliCommand: string;
  let spawnArgs: string[];
  let spawnEnv: NodeJS.ProcessEnv;

  if (cliProvider === 'claude') {
    // Claude CLI: claude -p --model <model> --allowedTools tool1,tool2
    cliCommand = 'claude';
    spawnArgs = ['-p', '--model', model];

    // Claude CLI expects: --allowedTools tool1,tool2 (comma-separated)
    if (allTools.length > 0) {
      spawnArgs.push('--allowedTools', allTools.join(','));
    }

    spawnEnv = {
      ...process.env,
      CLAUDE_TYPE: 'sub-agent',
      GK_PARENT_SESSION_ID: parentGkSessionId || '',
      GK_SUB_SESSION_ID: subAgentSessionId,
      CLAUDE_AGENT_ROLE: agentDisplayName,
      CLAUDE_AGENT_PROMPT: truncatedPrompt,
      CLAUDE_AGENT_MODEL: model || '',
      CLAUDE_AGENT_SKILLS: allSkills.join(','),
      CLAUDE_AGENT_CONTEXT: injectedContext.join(','),
      GK_ACTIVE_PLAN: activePlan || '',
      GK_SUGGESTED_PLAN: suggestedPlan || '',
      GK_PLAN_DATE_FORMAT: planDateFormat || ''
    };
  } else {
    // Gemini CLI: gemini -m <model> --allowed-tools ["tool1","tool2"]
    cliCommand = 'gemini';
    spawnArgs = ['-m', model];

    // Gemini CLI expects: --allowed-tools ["tool1","tool2","tool3"] (JSON array)
    if (allTools.length > 0) {
      spawnArgs.push('--allowed-tools', JSON.stringify(allTools));
    }

    spawnEnv = {
      ...process.env,
      GEMINI_TYPE: 'sub-agent',
      GEMINI_PARENT_SESSION_ID: parentGeminiSessionId || '',
      GK_PARENT_SESSION_ID: parentGkSessionId || '',
      GK_SUB_SESSION_ID: subAgentSessionId,
      GEMINI_AGENT_ROLE: agentDisplayName,
      GEMINI_AGENT_PROMPT: truncatedPrompt,
      GEMINI_AGENT_MODEL: model || '',
      GEMINI_AGENT_SKILLS: allSkills.join(','),
      GEMINI_AGENT_CONTEXT: injectedContext.join(','),
      GK_ACTIVE_PLAN: activePlan || '',
      GK_SUGGESTED_PLAN: suggestedPlan || '',
      GK_PLAN_DATE_FORMAT: planDateFormat || ''
    };
  }

  // Add team environment variables if spawning as team member
  if (teamContext) {
    spawnEnv = {
      ...spawnEnv,
      GK_TEAM_ID: teamContext.team!.teamId,
      GK_TEAM_NAME: teamContext.team!.teamName,
      GK_TEAM_ROLE: 'member',
      GK_TEAM_PORT: teamContext.port.toString(),
      GK_TEAM_LEADER_PORT: teamContext.team!.leaderPort.toString(),
      GK_AGENT_NAME: teamContext.memberName
    };

    // Register member in team
    addMemberToTeam(teamContext.sanitizedProjectDir, teamContext.team!.teamId, {
      agentId: subAgentSessionId,
      name: teamContext.memberName,
      agentType: options.agent || 'default',
      role: 'member',
      port: teamContext.port,
      pid: null,  // Will be updated after spawn
      status: 'starting'
    });
  }

  // Spawn with environment variables
  // Note: Sub-agent registration is handled by gk-session-init.cjs hook
  // GK_SUB_SESSION_ID is passed so hook uses same ID (prevents duplicate agents)
  const child = spawn(cliCommand, spawnArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: spawnEnv
  });

  // Update team member PID after spawn
  if (teamContext && child.pid) {
    updateMemberStatus(teamContext.sanitizedProjectDir, teamContext.team!.teamId, subAgentSessionId, 'ready');
  }

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.stdin.write(enrichedPrompt);
  child.stdin.end();

  child.on('close', (code) => {
    heartbeat.stop();

    if (elevatorMusic) {
      elevatorMusic.stop();
      console.log(brand.dim('Music stopped.'));
    }

    // Cleanup team member if applicable
    if (teamContext) {
      updateMemberStatus(teamContext.sanitizedProjectDir, teamContext.team!.teamId, subAgentSessionId, 'shutdown');
      releasePort(teamContext.sanitizedProjectDir, subAgentSessionId);
    }

    console.log();

    if (stdout) {
      console.log(stdout);
    }
    if (stderr) {
      console.error(stderr);
    }

    if (code === 0) {
      logger.success(`${agentDisplayName} agent completed successfully`);
    } else {
      logger.error(`${agentDisplayName} agent exited with code: ${code}`);
    }
    console.log();
    process.exit(code || 0);
  });

  child.on('error', (err) => {
    heartbeat.stop();
    if (elevatorMusic) {
      elevatorMusic.stop();
    }

    // Cleanup team member if applicable
    if (teamContext) {
      updateMemberStatus(teamContext.sanitizedProjectDir, teamContext.team!.teamId, subAgentSessionId, 'shutdown');
      releasePort(teamContext.sanitizedProjectDir, subAgentSessionId);
    }

    console.log();
    logger.error(`Failed to spawn agent: ${err.message}`);
    console.log();
    process.exit(1);
  });

  process.on('SIGINT', () => {
    heartbeat.stop();
    if (elevatorMusic) {
      elevatorMusic.stop();
    }
    child.kill('SIGTERM');
    process.exit(1);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERACTIVE MODE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleStart(options: {
  agent?: string;
  skills?: string;
  context?: string;
  model?: string;
  tools?: string;
  cli?: string;
}) {
  // Check if session already running
  if (isSessionActive()) {
    console.log();
    logger.error('Session already running. Use "gk agent stop" first.');
    console.log();
    process.exit(1);
  }

  const cliProvider: CliProvider = (options.cli === 'claude') ? 'claude' : 'gemini';
  const config = loadConfig();

  // Load agent profile with fallback
  let profile = null;
  if (options.agent) {
    profile = loadAgentProfileWithFallback(options.agent, cliProvider);
    if (!profile) {
      console.log();
      logger.error(`Agent profile not found: ${options.agent}`);
      console.log(brand.dim(`Searched: .${cliProvider === 'claude' ? 'claude' : 'gemini'}/agents/ and fallback folder`));
      console.log();
      process.exit(1);
    }
  }

  // Determine model
  let model = options.model || profile?.model || config.spawn.defaultModel;
  model = mapModel(model, cliProvider);

  // Build tools list
  const cliTools = options.tools?.split(',').map(s => s.trim()).filter(Boolean) || [];
  const agentTools = profile?.tools || [];
  const mergedTools = [...new Set([...agentTools, ...cliTools])];
  const allTools = mapTools(mergedTools, cliProvider);

  // Build skills list and load content
  const cliSkills = options.skills?.split(',').map(s => s.trim()).filter(Boolean) || [];
  const agentSkills = profile?.skills || [];
  const allSkills = [...new Set([...agentSkills, ...cliSkills])];

  const skillContents: Record<string, string> = {};
  for (const skill of allSkills) {
    const content = loadSkillContent(skill);
    if (content) skillContents[skill] = content;
  }

  // Load context files (reuse logic from handleSpawn)
  const contextFiles: LoadedContext[] = [];
  if (options.context) {
    const contextRefs = options.context.split(',').flatMap(part => part.trim().split(/\s+/).filter(s => s)).filter(s => s);
    for (const ref of contextRefs) {
      try {
        const loaded = await loadContextFile(ref);
        if (Array.isArray(loaded)) {
          contextFiles.push(...loaded);
        } else {
          contextFiles.push(loaded);
        }
      } catch (error) {
        console.log();
        logger.error((error as Error).message);
        console.log();
        process.exit(1);
      }
    }
  }

  // Single agent mode - fixed port
  const sessionPort = 3377;

  // Create session state
  const sessionState: PtySessionState = {
    provider: cliProvider,
    model,
    port: sessionPort,
    pid: 0,
    isFirstSend: true,
    context: {
      agentName: profile?.name || null,
      agentContent: profile?.content || null,
      skills: allSkills,
      skillContents,
      contextFiles,
      tools: allTools
    },
    startedAt: new Date().toISOString()
  };

  // Save session state first (server will read it)
  saveSession(sessionState);

  console.log();
  logger.info(`Starting ${brand.primary(cliProvider)} interactive session...`);
  logger.info(`Model: ${brand.primary(model)}`);
  if (profile) {
    logger.info(`Agent: ${brand.dim(profile.name)}`);
  }
  if (allSkills.length > 0) {
    logger.info(`Skills: ${brand.dim(allSkills.join(', '))}`);
  }
  if (allTools.length > 0) {
    logger.info(`Tools: ${brand.dim(allTools.join(', '))}`);
  }
  console.log();

  // Spawn server as DETACHED background process
  const scriptPath = process.argv[1];
  const serverProcess = spawn(process.execPath, [scriptPath, 'agent', '_server'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: process.cwd(),
    env: process.env
  });

  serverProcess.unref();

  // Update session with server PID
  sessionState.pid = serverProcess.pid || 0;
  saveSession(sessionState);

  logger.info(`Server started (PID: ${serverProcess.pid}, Port: ${sessionPort})`);
  logger.info('Waiting for AI to initialize...');

  // Poll for server to be ready (up to 120s for first npx download)
  const client = new PtyClient(sessionState.port);
  const maxAttempts = 120;

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(1000);
    try {
      const status = await client.status();
      if (status.ready) {
        console.log();
        logger.success('Session ready!');
        console.log();
        console.log('Usage:');
        console.log(`  ${brand.dim('gk agent send "your prompt"')}`);
        console.log(`  ${brand.dim('gk agent wait')}`);
        console.log(`  ${brand.dim('gk agent exchange')}`);
        console.log(`  ${brand.dim('gk agent stop')}`);
        console.log();
        return;
      }
    } catch {
      // Server not ready yet, continue polling
    }
    process.stdout.write('.');
  }

  // Timeout reached
  console.log();
  logger.warn('Server started but AI may still be initializing.');
  logger.info('Check status with: gk agent status');
  console.log();
}

/**
 * Internal server handler - runs in background process (single agent mode)
 */
async function handleServerInternal() {
  const session = loadSession();

  if (!session) {
    console.error('[Server] No session state found');
    process.exit(1);
  }

  const server = new PtyServer({
    provider: session.provider,
    model: session.model,
    tools: session.context.tools,
    sessionState: session,
    port: session.port,
    debug: false
  });

  try {
    await server.start();
  } catch (err) {
    console.error(`[Server] Failed to start: ${(err as Error).message}`);
    clearSession();
    process.exit(1);
  }

  // Handle shutdown signals
  process.on('SIGINT', async () => {
    await server.stop();
    clearSession();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    clearSession();
    process.exit(0);
  });
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function handleSend(prompt: string) {
  const session = loadSession();
  if (!session || !isSessionActive()) {
    console.log();
    logger.error('No active session. Use "gk agent start" first.');
    console.log();
    process.exit(1);
  }

  const client = new PtyClient(session.port);

  let finalPrompt = prompt;

  // First send: wrap with full context
  if (session.isFirstSend) {
    finalPrompt = buildFirstSendPrompt(prompt, session);
    markFirstSendComplete();
  }

  try {
    const result = await client.send(finalPrompt);
    if (result.ok) {
      logger.info(`Sent prompt${result.exchangeId ? ` (exchange: ${result.exchangeId.slice(0, 8)}...)` : ''}`);
    } else {
      logger.error(result.error || 'Failed to send');
    }
  } catch (err) {
    logger.error(`Failed to send: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function handleWait(timeout: number) {
  const session = loadSession();
  if (!session || !isSessionActive()) {
    console.log();
    logger.error('No active session.');
    console.log();
    process.exit(1);
  }

  const client = new PtyClient(session.port);
  console.log(`Waiting for completion (timeout: ${timeout}s)...`);

  const startTime = Date.now();
  const timeoutMs = timeout * 1000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = await client.complete();

      if (result.complete) {
        console.log('\nComplete!');
        return;
      }

      if (result.reason === 'pending_tool') {
        console.log('\n');
        logger.warn('Tool confirmation required');
        if (result.hint) {
          console.log(brand.dim(result.hint));
        }
        console.log(brand.dim('Use: gk agent pending'));
        return;
      }
    } catch (err) {
      logger.error((err as Error).message);
      return;
    }

    await sleep(2000);
    process.stdout.write('.');
  }

  console.log('');
  logger.warn('Timeout reached. AI may still be working.');
}

async function handleExchange() {
  const session = loadSession();
  if (!session || !isSessionActive()) {
    console.log();
    logger.error('No active session.');
    console.log();
    process.exit(1);
  }

  const client = new PtyClient(session.port);

  try {
    const exchange = await client.exchange();
    console.log(JSON.stringify(exchange, null, 2));
  } catch (err) {
    logger.error((err as Error).message);
    process.exit(1);
  }
}

async function handlePending() {
  const session = loadSession();
  if (!session || !isSessionActive()) {
    console.log();
    logger.error('No active session.');
    console.log();
    process.exit(1);
  }

  const client = new PtyClient(session.port);

  try {
    const pending = await client.pending();

    if (pending.hasPending) {
      console.log();
      logger.warn('Tool confirmation required');
      console.log(JSON.stringify(pending, null, 2));
      console.log();
      console.log('To approve: ' + brand.primary('gk agent send "1"'));
      console.log('To reject:  ' + brand.primary('gk agent send "3"'));
      console.log();
    } else {
      console.log('No pending confirmations');
    }
  } catch (err) {
    logger.error((err as Error).message);
    process.exit(1);
  }
}

async function handleRead(lines: number) {
  const session = loadSession();
  if (!session || !isSessionActive()) {
    console.log();
    logger.error('No active session.');
    console.log();
    process.exit(1);
  }

  const client = new PtyClient(session.port);

  try {
    const output = await client.read(lines);
    console.log(output);
  } catch (err) {
    logger.error((err as Error).message);
    process.exit(1);
  }
}

async function handleInteractiveStatus() {
  const session = loadSession();

  if (!session) {
    console.log('No session file found.');
    return;
  }

  if (!isSessionActive()) {
    console.log('Session file exists but process not running.');
    console.log('Cleaning up...');
    clearSession();
    return;
  }

  const client = new PtyClient(session.port);

  try {
    const status = await client.status();

    console.log();
    console.log(pc.bold('Session: ') + brand.success('ACTIVE'));
    console.log(`Provider: ${session.provider}`);
    console.log(`Model: ${session.model}`);
    console.log(`PID: ${session.pid}`);
    console.log(`Started: ${session.startedAt}`);
    console.log(`First send pending: ${session.isFirstSend}`);
    if (session.context.agentName) {
      console.log(`Agent: ${session.context.agentName}`);
    }
    if (session.context.skills.length > 0) {
      console.log(`Skills: ${session.context.skills.join(', ')}`);
    }
    console.log(`Output buffer: ${status.outputLength} bytes`);
    console.log();
  } catch (err) {
    logger.error((err as Error).message);
    process.exit(1);
  }
}

/**
 * Check if a process is running by PID
 */
function isProcessRunning(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Force kill a process by PID (aligned with gk team kill)
 */
function forceKillProcess(pid: number): boolean {
  if (!pid || pid <= 0) return false;

  try {
    if (process.platform === 'win32') {
      // Use cmd.exe to run taskkill (works regardless of shell environment)
      const { execSync } = require('child_process');
      execSync(`cmd.exe /c taskkill /F /T /PID ${pid}`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000
      });
    } else {
      process.kill(pid, 'SIGKILL');
    }
    return true;
  } catch {
    // Try Node.js native kill as fallback
    try {
      process.kill(pid, 'SIGKILL');
      return true;
    } catch {
      return false;
    }
  }
}

async function handleStop() {
  const session = loadSession();

  if (!session) {
    console.log('No active session.');
    return;
  }

  const pid = session.pid;

  // Try graceful shutdown first via server command
  if (isSessionActive()) {
    try {
      const client = new PtyClient(session.port);
      await client.stop();
      logger.info('Sent stop command to server...');

      // Wait briefly for graceful shutdown
      await sleep(2000);
    } catch {
      // Server may have already stopped
    }
  }

  // Force kill if still running (aligned with gk team kill approach)
  if (pid && isProcessRunning(pid)) {
    logger.info(`Force killing server process (PID: ${pid})...`);
    const killed = forceKillProcess(pid);
    if (killed) {
      logger.info(`Process ${pid} killed.`);
    } else {
      logger.warn(`Could not kill process ${pid} (may already be dead).`);
    }
  }

  clearSession();
  logger.success('Session stopped.');
}

// Helper: Load context file (simplified version)
async function loadContextFile(contextRef: string): Promise<LoadedContext | LoadedContext[]> {
  let fullPath = contextRef;

  if (contextRef.startsWith('@')) {
    const relativePath = contextRef.substring(1);
    const searchPaths = [
      join(process.cwd(), '.docs', relativePath),
      join(process.cwd(), '.plans', relativePath),
      join(process.cwd(), 'docs', relativePath),
      join(process.cwd(), 'plans', relativePath),
      join(process.cwd(), relativePath)
    ];

    let found = false;
    for (const searchPath of searchPaths) {
      try {
        await access(searchPath);
        fullPath = searchPath;
        found = true;
        break;
      } catch {
        continue;
      }
    }

    if (!found) {
      throw new Error(`Context file not found: ${contextRef}`);
    }
  }

  const fileStat = await stat(fullPath);

  if (fileStat.isDirectory()) {
    // Load directory recursively
    const contexts: LoadedContext[] = [];
    const extensions = ['.md', '.txt', '.json', '.yaml', '.yml'];

    async function walkDir(dirPath: string, depth: number = 0): Promise<void> {
      if (depth > 3) return;
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const entryPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await walkDir(entryPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            const content = await readFile(entryPath, 'utf-8');
            contexts.push({
              type: 'context',
              name: entry.name,
              path: entryPath,
              relativePath: relative(fullPath, entryPath),
              content: content.trim(),
              originalRef: `${contextRef}/${relative(fullPath, entryPath)}`
            });
          }
        }
      }
    }

    await walkDir(fullPath);
    return contexts;
  }

  // Single file
  const content = await readFile(fullPath, 'utf-8');
  return {
    type: 'context',
    name: basename(fullPath),
    path: fullPath,
    content: content.trim(),
    originalRef: contextRef
  };
}
