/**
 * Agent Office command - Gamified visualization for multi-agent workflows
 */

import type { CAC } from 'cac';
import {
  startWebDashboard,
  OfficeEventEmitter,
  createInitialState,
  SessionFileWatcher,
  sessionToOfficeState,
} from '../../domains/agent-office/index.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';

interface OfficeOptions {
  web?: boolean;
  port?: number;
  open?: boolean;
  json?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELP FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function showMainHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('Agent Office')));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk office')} <subcommand> [options]`);
  console.log();
  console.log('Subcommands:');
  console.log(`  ${brand.primary('start')}             Start the visualization`);
  console.log(`  ${brand.primary('status')}            Show current office state`);
  console.log(`  ${brand.primary('watch')}             Watch office state changes`);
  console.log();
  console.log('Options:');
  console.log(`  ${brand.dim('-p, --port <n>')}    [start] Web server port (default: 3847)`);
  console.log(`  ${brand.dim('--no-open')}         [start] Don't auto-open browser`);
  console.log(`  ${brand.dim('--json')}            [status/watch] Output as JSON`);
  console.log();
  console.log('Examples:');
  console.log(`  ${brand.dim('gk office start')}`);
  console.log(`  ${brand.dim('gk office start --port 4000')}`);
  console.log(`  ${brand.dim('gk office status --json')}`);
  console.log(`  ${brand.dim('gk office watch')}`);
  console.log();
}

function showStartHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('gk office start')));
  console.log(brand.dim('Start the Agent Office web dashboard'));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk office start')} [options]`);
  console.log();
  console.log('Options:');
  console.log(`  ${brand.dim('-p, --port <n>')}    Web server port (default: 3847)`);
  console.log(`  ${brand.dim('--no-open')}         Don't auto-open browser`);
  console.log();
  console.log('Examples:');
  console.log(`  ${brand.dim('gk office start')}`);
  console.log(`  ${brand.dim('gk office start --port 4000')}`);
  console.log(`  ${brand.dim('gk office start --port 4000 --no-open')}`);
  console.log();
}

function showStatusHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('gk office status')));
  console.log(brand.dim('Show current Agent Office state'));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk office status')} [options]`);
  console.log();
  console.log('Options:');
  console.log(`  ${brand.dim('--json')}    Output as JSON`);
  console.log();
}

function showWatchHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('gk office watch')));
  console.log(brand.dim('Watch Agent Office state changes in real-time'));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk office watch')} [options]`);
  console.log();
  console.log('Options:');
  console.log(`  ${brand.dim('--json')}    Output as JSON`);
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle start subcommand
 */
async function handleStart(options: OfficeOptions): Promise<void> {
  console.log();
  logger.info('Starting Agent Office...');
  console.log();

  try {
    const dashboard = await startWebDashboard({
      port: options.port || 3847,
      autoOpen: options.open !== false,
      onReady: (port) => {
        logger.success(`Dashboard running at ${brand.primary(`http://localhost:${port}`)}`);
        console.log(brand.dim('  Press Ctrl+C to stop'));
        console.log();
      },
      onError: (error) => {
        logger.error(`Error: ${error.message}`);
      },
    });

    process.on('SIGINT', () => {
      dashboard.stop();
      console.log();
      logger.info('Agent Office stopped.');
      console.log();
      process.exit(0);
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'No active session found') {
        console.log();
        logger.warn('No active session found.');
        console.log(brand.dim('  Start a GemKit session first with: gk agent'));
        console.log();
      } else {
        logger.error(`Failed to start: ${error.message}`);
      }
    }
    process.exit(1);
  }
}

/**
 * Handle status subcommand
 */
function handleStatus(options: OfficeOptions): void {
  const emitter = new OfficeEventEmitter(createInitialState());
  const watcher = new SessionFileWatcher({
    onSessionChange: (session) => {
      const state = sessionToOfficeState(session);

      if (options.json) {
        console.log(JSON.stringify({
          ...state,
          agents: Object.fromEntries(state.agents),
        }, null, 2));
      } else {
        console.log();
        console.log(pc.bold(brand.geminiPurple('Agent Office Status')));
        console.log(ui.line());
        console.log();
        console.log(`  ${brand.dim('Active Plan:')}    ${state.activePlan ? brand.primary(state.activePlan) : brand.dim('(none)')}`);
        console.log(`  ${brand.dim('Agents:')}         ${state.agents.size}`);
        console.log(`  ${brand.dim('Inbox Items:')}    ${state.inbox.length}`);
        console.log(`  ${brand.dim('Documents:')}      ${state.documents.length}`);

        if (state.agents.size > 0) {
          console.log();
          console.log(brand.dim('  Agents:'));
          for (const [id, agent] of state.agents) {
            const statusColor = agent.state === 'working' ? brand.warn :
                               agent.state === 'idle' ? brand.success : brand.dim;
            console.log(`    ${agent.icon} ${brand.primary(agent.role)} ${statusColor(`[${agent.state}]`)}`);
          }
        }
        console.log();
      }

      watcher.stop();
      emitter.dispose();
    },
    onEvent: () => {}, // No-op for status
    onError: (error) => {
      console.log();
      logger.error(`Error: ${error.message}`);
      console.log();
      process.exit(1);
    },
  });

  const started = watcher.start();
  if (!started) {
    console.log();
    logger.warn('No active session found.');
    console.log(brand.dim('  Start a GemKit session first with: gk agent'));
    console.log();
    process.exit(1);
  }
}

/**
 * Handle watch subcommand
 */
function handleWatch(options: OfficeOptions): void {
  console.log();
  logger.info('Watching Agent Office state...');
  console.log(brand.dim('  Press Ctrl+C to stop'));
  console.log();

  const emitter = new OfficeEventEmitter(createInitialState());
  const watcher = new SessionFileWatcher({
    onSessionChange: (session) => {
      const state = sessionToOfficeState(session);

      if (options.json) {
        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          ...state,
          agents: Object.fromEntries(state.agents),
        }));
      } else {
        const time = new Date().toLocaleTimeString();
        console.log(`${brand.dim(time)} ${brand.info('State:')} ${state.agents.size} agents, ${state.inbox.length} inbox items`);
      }
    },
    onEvent: (event) => {
      if (options.json) {
        console.log(JSON.stringify({ type: 'event', event }));
      } else {
        const time = new Date().toLocaleTimeString();
        console.log(`${brand.dim(time)} ${brand.secondary('Event:')} ${event.type}`);
      }
    },
    onError: (error) => {
      logger.error(`Error: ${error.message}`);
    },
  });

  const started = watcher.start();
  if (!started) {
    console.log();
    logger.warn('No active session found.');
    console.log(brand.dim('  Start a GemKit session first with: gk agent'));
    console.log();
    process.exit(1);
  }

  process.on('SIGINT', () => {
    watcher.stop();
    emitter.dispose();
    console.log();
    logger.info('Stopped watching.');
    console.log();
    process.exit(0);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

export function registerOfficeCommand(cli: CAC): void {
  cli
    .command('office [subcommand]', 'Agent Office visualization (start, status, watch)')
    .option('-p, --port <port>', '[start] Web server port', { default: 3847 })
    .option('--no-open', "[start] Don't auto-open browser")
    .option('--json', '[status/watch] Output as JSON')
    .action(async (subcommand: string | undefined, options: OfficeOptions & { help?: boolean; h?: boolean }) => {
      // Parse port as number
      if (options.port) {
        options.port = parseInt(String(options.port), 10);
      }

      // Handle help for subcommands
      if (options.help || options.h) {
        switch (subcommand) {
          case 'start':
            showStartHelp();
            return;
          case 'status':
            showStatusHelp();
            return;
          case 'watch':
            showWatchHelp();
            return;
          default:
            showMainHelp();
            return;
        }
      }

      // Route to handlers
      switch (subcommand) {
        case 'start':
          await handleStart(options);
          break;
        case 'status':
          handleStatus(options);
          break;
        case 'watch':
          handleWatch(options);
          break;
        case undefined:
        case 'help':
          showMainHelp();
          break;
        default:
          console.log();
          logger.error(`Unknown subcommand: ${subcommand}`);
          showMainHelp();
          process.exit(1);
      }
    });
}
