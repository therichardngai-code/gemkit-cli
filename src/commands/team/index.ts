/**
 * Team command - Team management, agent spawning, and coordination
 * Provides CLI access to team coordination features
 */

import type { CAC } from 'cac';
import { spawn, execSync } from 'child_process';
import { access, stat, readdir, readFile } from 'fs/promises';
import { join, basename, extname, relative } from 'path';
import { sanitizeProjectPath } from '../../utils/paths.js';
import {
  listTeams,
  getTeam,
  getTaskList,
  getTaskSummary,
  cleanupStalePorts,
  getPortStats,
  deleteAllTeamData,
  cleanupOrphanedMembers,
  emergencyTeamShutdown,
  // Creation functions
  createTeam,
  addMemberToTeam,
  allocatePort,
  releasePort,
  updateMemberStatus,
  updateMemberPid,
  createTask,
  claimTask,
  completeTask,
  sendMessage,
  broadcast,
  // Central inbox
  readInbox,
  getPendingApprovals,
  formatMessageForDisplay,
  validateAndApprove
} from '../../domains/team/index.js';
import type { InboxFilters, MessageType } from '../../domains/team/types.js';
import { generateGkSessionId } from '../../services/hash.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';
import { PtyClient } from '../../services/pty-client.js';
import { loadConfig } from '../../domains/config/manager.js';
import { loadAgentProfileWithFallback } from '../../domains/agent/profile.js';
import { loadSkillContent } from '../../domains/agent/search.js';
import { mapModel, mapTools } from '../../domains/agent/mappings.js';
import type { CliProvider } from '../../domains/agent/types.js';
import type { PtySessionState, LoadedContext } from '../../domains/agent/pty-types.js';
import {
  saveSession,
  loadSession,
  clearSession
} from '../../domains/agent/pty-session.js';

// ============================================================================
// HELP FUNCTIONS
// ============================================================================

function showMainHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('Team Management')));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk team')} <subcommand> [options]`);
  console.log();
  console.log('Team Operations:');
  console.log(`  ${brand.primary('create')} <name>        Create a new team`);
  console.log(`  ${brand.primary('list')}                 List all teams`);
  console.log(`  ${brand.primary('info')} [teamId]        Show team details`);
  console.log();
  console.log('Agent Spawning:');
  console.log(`  ${brand.primary('start')} --name <agent> Start agent as team member`);
  console.log(`  ${brand.primary('add-member')} <name>    Register member (no spawn)`);
  console.log();
  console.log('Task Operations:');
  console.log(`  ${brand.primary('task-create')} <subject> Create a task`);
  console.log(`  ${brand.primary('task-claim')} <taskId>   Claim a task`);
  console.log(`  ${brand.primary('task-done')} <taskId>    Mark task completed`);
  console.log(`  ${brand.primary('tasks')} [teamId]        List all tasks`);
  console.log();
  console.log('Messaging & Inbox:');
  console.log(`  ${brand.primary('send')} <to> <message>   Send message to member`);
  console.log(`  ${brand.primary('broadcast')} <message>   Send to all members`);
  console.log(`  ${brand.primary('messages')}              View central inbox (all activity)`);
  console.log(`  ${brand.primary('respond')} <msgId>       Respond to approval request`);
  console.log();
  console.log('Agent Interaction:');
  console.log(`  ${brand.primary('exchange')} <agent>      Get structured output from agent`);
  console.log(`  ${brand.primary('read')} <agent>          Read raw output from agent`);
  console.log();
  console.log('Maintenance:');
  console.log(`  ${brand.primary('ports')}                 Show port allocations`);
  console.log(`  ${brand.primary('cleanup')}               Clean up stale resources`);
  console.log(`  ${brand.primary('kill')} [teamId]         Emergency shutdown`);
  console.log(`  ${brand.primary('reset')}                 Delete all team data`);
  console.log();
  console.log('Examples:');
  console.log(`  ${brand.dim('gk team create jwt-research')}`);
  console.log(`  ${brand.dim('gk team start --name researcher-1 -a researcher')}`);
  console.log(`  ${brand.dim('gk team start --name planner -a planner -c @plans/')}`);
  console.log(`  ${brand.dim('gk team task-create "Research JWT security"')}`);
  console.log(`  ${brand.dim('gk team send researcher-1 "Claim task X"')}`);
  console.log(`  ${brand.dim('gk team messages --pending')}`);
  console.log(`  ${brand.dim('gk team respond <msgId> --approve')}`);
  console.log();
}

// ============================================================================
// COMMAND REGISTRATION
// ============================================================================

export function registerTeamCommand(cli: CAC): void {
  cli
    .command('team [subcommand] [arg] [arg2]', 'Team management (list, info, tasks)')
    .option('--json', 'Output as JSON')
    .option('--desc <description>', 'Description for team/task')
    .option('--blocked-by <taskIds>', 'Comma-separated task IDs that block this task')
    .option('--as <agentName>', 'Act as this agent (for testing)')
    // Messages/Inbox options
    .option('--pending', '[messages] Show only pending items')
    .option('--type <type>', '[messages] Filter by message type')
    .option('--from <name>', '[messages] Filter by sender name')
    .option('--to <name>', '[messages] Filter by recipient name')
    .option('--limit <n>', '[messages] Limit results')
    // Respond options
    .option('--approve', '[respond] Approve the request')
    .option('--reject <reason>', '[respond] Reject with reason')
    .option('--approve-all', '[respond] Approve all pending requests')
    // Team start options
    .option('--name <memberName>', '[start] Agent name in team (required)')
    .option('--role <role>', '[start] Role: leader or member (default: member)')
    .option('-a, --agent <profile>', '[start] Agent profile name')
    .option('-s, --skills <list>', '[start] Comma-separated skill names')
    .option('-m, --model <model>', '[start] Model override')
    .option('-t, --tools <list>', '[start] Comma-separated tools')
    .option('-c, --context <files>', '[start] Context files (@file syntax)')
    .option('--cli <provider>', '[start] CLI provider: gemini (default) or claude')
    .action(async (subcommand: string | undefined, arg: string | undefined, arg2: string | undefined, options: any) => {
      if (options.help || options.h) {
        showMainHelp();
        return;
      }

      const projectDir = sanitizeProjectPath(process.cwd());

      switch (subcommand) {
        // Team operations
        case 'create':
          await handleCreate(projectDir, arg, options);
          break;
        case 'add-member':
          await handleAddMember(projectDir, arg, options);
          break;
        case 'list':
          await handleList(projectDir, options);
          break;
        case 'info':
          await handleInfo(projectDir, arg, options);
          break;

        // Task operations
        case 'task-create':
          await handleTaskCreate(projectDir, arg, options);
          break;
        case 'task-claim':
          await handleTaskClaim(projectDir, arg, options);
          break;
        case 'task-done':
          await handleTaskDone(projectDir, arg, options);
          break;
        case 'tasks':
          await handleTasks(projectDir, arg, options);
          break;

        // Messaging
        case 'send':
          await handleSend(projectDir, arg, arg2, options);
          break;
        case 'broadcast':
          await handleBroadcast(projectDir, arg, options);
          break;
        case 'messages':
          await handleMessages(projectDir, options);
          break;
        case 'respond':
          await handleRespond(projectDir, arg, options);
          break;

        // Agent spawning
        case 'start':
          await handleTeamStart(projectDir, options);
          break;

        // Agent interaction
        case 'exchange':
          await handleTeamExchange(projectDir, arg, options);
          break;
        case 'read':
          await handleTeamRead(projectDir, arg);
          break;

        // Maintenance
        case 'ports':
          await handlePorts(projectDir, options);
          break;
        case 'cleanup':
          await handleCleanup(projectDir);
          break;
        case 'kill':
          await handleKill(projectDir, arg);
          break;
        case 'reset':
          await handleReset(projectDir);
          break;
        case '_server':
          // Hidden command: runs team agent server in background
          await handleTeamServerInternal();
          break;
        default:
          showMainHelp();
      }
    });
}

// ============================================================================
// HANDLERS
// ============================================================================

async function handleList(projectDir: string, options: { json?: boolean }) {
  const teams = listTeams(projectDir);

  if (options.json) {
    console.log(JSON.stringify(teams, null, 2));
    return;
  }

  console.log();
  console.log(pc.bold(brand.geminiPurple('Teams')));
  console.log();

  if (teams.length === 0) {
    console.log(brand.dim('  No teams found in this project.'));
    console.log();
    return;
  }

  for (const team of teams) {
    const statusColor = team.status === 'active' ? brand.success : brand.dim;
    console.log(`  ${brand.primary(team.teamName)} ${brand.dim(`(${team.teamId.slice(0, 12)}...)`)}`);
    console.log(`    Status: ${statusColor(team.status)}`);
    console.log(`    Members: ${team.members.length}`);
    console.log(`    Created: ${team.createdAt}`);
    console.log();
  }
}

async function handleInfo(projectDir: string, teamId: string | undefined, options: { json?: boolean }) {
  if (!teamId) {
    // Try to find the active team
    const teams = listTeams(projectDir).filter(t => t.status === 'active');
    if (teams.length === 0) {
      logger.error('No active team found. Specify team ID.');
      return;
    }
    teamId = teams[0].teamId;
  }

  const team = getTeam(projectDir, teamId);
  if (!team) {
    logger.error(`Team not found: ${teamId}`);
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(team, null, 2));
    return;
  }

  console.log();
  console.log(ui.doubleLine());
  console.log(pc.bold(brand.geminiPurple(`Team: ${team.teamName}`)));
  console.log(ui.doubleLine());
  console.log();
  console.log(`  ${brand.dim('ID:')}          ${team.teamId}`);
  console.log(`  ${brand.dim('Status:')}      ${team.status}`);
  console.log(`  ${brand.dim('Description:')} ${team.description || '(none)'}`);
  console.log(`  ${brand.dim('Leader:')}      ${team.leaderId.slice(0, 20)}...`);
  console.log(`  ${brand.dim('Leader Port:')} ${team.leaderPort}`);
  console.log(`  ${brand.dim('Created:')}     ${team.createdAt}`);
  console.log();
  console.log(brand.dim('  --- Members ---'));
  console.log();

  for (const member of team.members) {
    const statusIcon = {
      'ready': brand.success('●'),
      'busy': brand.warn('●'),
      'idle': brand.dim('●'),
      'shutdown': brand.error('●'),
      'starting': brand.dim('○')
    }[member.status] || brand.dim('?');

    console.log(`  ${statusIcon} ${brand.primary(member.name)} (${member.role})`);
    console.log(`      Agent ID: ${member.agentId.slice(0, 20)}...`);
    console.log(`      Port: ${member.port}, PID: ${member.pid || 'N/A'}`);
    console.log(`      Status: ${member.status}`);
    console.log();
  }
}

async function handleTasks(projectDir: string, teamId: string | undefined, options: { json?: boolean }) {
  if (!teamId) {
    // Try to find the active team
    const teams = listTeams(projectDir).filter(t => t.status === 'active');
    if (teams.length === 0) {
      logger.error('No active team found. Specify team ID.');
      return;
    }
    teamId = teams[0].teamId;
  }

  const taskList = getTaskList(projectDir, teamId);
  const summary = getTaskSummary(projectDir, teamId);

  if (options.json) {
    console.log(JSON.stringify({ ...taskList, summary }, null, 2));
    return;
  }

  console.log();
  console.log(pc.bold(brand.geminiPurple('Tasks')));
  console.log();
  console.log(`  Total: ${summary.total}  |  ` +
    `${brand.success('Completed:')} ${summary.completed}  |  ` +
    `${brand.warn('In Progress:')} ${summary.inProgress}  |  ` +
    `${brand.dim('Pending:')} ${summary.pending}  |  ` +
    `${brand.error('Blocked:')} ${summary.blocked}`);
  console.log();

  if (taskList.tasks.length === 0) {
    console.log(brand.dim('  No tasks.'));
    console.log();
    return;
  }

  // Show available tasks first
  if (taskList.available.length > 0) {
    console.log(brand.success('  Available (ready to claim):'));
    for (const task of taskList.available) {
      console.log(`    ${brand.dim(task.taskId.slice(0, 12))} ${task.subject}`);
    }
    console.log();
  }

  // In progress
  if (taskList.inProgress.length > 0) {
    console.log(brand.warn('  In Progress:'));
    for (const task of taskList.inProgress) {
      console.log(`    ${brand.dim(task.taskId.slice(0, 12))} ${task.subject} ${brand.dim(`[${task.owner}]`)}`);
    }
    console.log();
  }

  // Blocked
  if (taskList.blocked.length > 0) {
    console.log(brand.error('  Blocked:'));
    for (const task of taskList.blocked) {
      console.log(`    ${brand.dim(task.taskId.slice(0, 12))} ${task.subject}`);
      console.log(`      ${brand.dim('Waiting on:')} ${task.blockedBy.map(id => id.slice(0, 8)).join(', ')}`);
    }
    console.log();
  }

  // Completed
  if (taskList.completed.length > 0) {
    console.log(brand.success('  Completed:'));
    for (const task of taskList.completed.slice(-5)) {  // Show last 5
      console.log(`    ${brand.dim(task.taskId.slice(0, 12))} ${brand.dim(task.subject)}`);
    }
    if (taskList.completed.length > 5) {
      console.log(brand.dim(`    ... and ${taskList.completed.length - 5} more`));
    }
    console.log();
  }
}

async function handlePorts(projectDir: string, options: { json?: boolean }) {
  const stats = getPortStats(projectDir);

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log();
  console.log(pc.bold(brand.geminiPurple('Port Allocations')));
  console.log();
  console.log(`  Range: 3377-3476 (${stats.total} ports)`);
  console.log(`  Used: ${stats.used}`);
  console.log(`  Available: ${stats.available}`);
  console.log();

  if (Object.keys(stats.byTeam).length > 0) {
    console.log(brand.dim('  By Team:'));
    for (const [teamId, count] of Object.entries(stats.byTeam)) {
      console.log(`    ${teamId.slice(0, 20)}...: ${count} ports`);
    }
    console.log();
  }
}

async function handleCleanup(projectDir: string) {
  console.log();
  logger.info('Cleaning up stale ports and orphaned members...');

  // Clean up orphaned members first
  const orphanResult = await cleanupOrphanedMembers(projectDir);

  if (orphanResult.orphansFound > 0) {
    logger.success(`Found ${orphanResult.orphansFound} orphaned member(s), cleaned ${orphanResult.cleaned}.`);
  }

  // Then clean up stale ports
  const stalePorts = await cleanupStalePorts(projectDir);

  if (stalePorts > 0) {
    logger.success(`Released ${stalePorts} additional stale port(s).`);
  }

  if (orphanResult.orphansFound === 0 && stalePorts === 0) {
    logger.info('No stale resources found.');
  }

  console.log();
  console.log(brand.dim(`  Teams checked: ${orphanResult.teamsChecked}`));
  console.log(brand.dim(`  Members checked: ${orphanResult.membersChecked}`));
  console.log();
}

/**
 * Kill processes listening on gk team port range (3377-3476)
 * Handles orphaned processes even when team data is missing
 * Supports Windows and Unix platforms
 */
async function killOrphanedPortProcesses(): Promise<number> {
  const PORT_MIN = 3377;
  const PORT_MAX = 3476;
  let killed = 0;

  const pidsToKill = new Set<number>();

  try {
    if (process.platform === 'win32') {
      // Windows: parse netstat -ano output
      const output = execSync('netstat -ano', { encoding: 'utf-8', timeout: 15000 });

      for (const line of output.split('\n')) {
        // Match: TCP    127.0.0.1:3377    0.0.0.0:0    LISTENING    12345
        // Match: TCP    0.0.0.0:3377      0.0.0.0:0    LISTENING    12345
        // Capture port and PID from any listening TCP connection
        const match = line.match(/TCP\s+(?:127\.0\.0\.1|0\.0\.0\.0):(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
        if (match) {
          const port = parseInt(match[1], 10);
          const pid = parseInt(match[2], 10);
          if (port >= PORT_MIN && port <= PORT_MAX && pid > 0) {
            pidsToKill.add(pid);
          }
        }
      }
    } else {
      // Unix: try lsof first (macOS + Linux), fallback to ss (Linux)
      let output = '';
      try {
        output = execSync(`lsof -iTCP:${PORT_MIN}-${PORT_MAX} -sTCP:LISTEN -t 2>/dev/null`, {
          encoding: 'utf-8',
          timeout: 15000
        });
      } catch {
        try {
          // ss output format: LISTEN  0  128  0.0.0.0:3377  0.0.0.0:*  users:(("node",pid=1234,fd=3))
          output = execSync(`ss -tlnp 2>/dev/null | grep -E ':3[34][0-9]{2}\\s'`, {
            encoding: 'utf-8',
            timeout: 15000
          });
          // Extract PIDs from ss output
          const pidMatches = output.matchAll(/pid=(\d+)/g);
          for (const m of pidMatches) {
            const pid = parseInt(m[1], 10);
            if (pid > 1) pidsToKill.add(pid);
          }
          output = ''; // Already processed
        } catch {
          // Neither lsof nor ss available
        }
      }

      // Parse lsof -t output (just PIDs, one per line)
      if (output) {
        for (const pidStr of output.trim().split('\n')) {
          const pid = parseInt(pidStr.trim(), 10);
          if (pid > 1) pidsToKill.add(pid);
        }
      }
    }
  } catch {
    // Port scanning failed
  }

  // Kill collected PIDs
  for (const pid of pidsToKill) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /T /PID ${pid}`, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000
        });
      } else {
        process.kill(pid, 'SIGKILL');
      }
      killed++;
      logger.info(`  Killed orphaned process PID ${pid}`);
    } catch {
      // Process already exited
    }
  }

  return killed;
}

async function handleKill(projectDir: string, teamId: string | undefined) {
  if (!teamId) {
    // Kill all teams
    const teams = listTeams(projectDir).filter(t => t.status === 'active');

    let totalKilled = 0;
    let totalCleaned = 0;

    if (teams.length > 0) {
      console.log();
      logger.warn(`Emergency shutdown of ${teams.length} team(s)...`);

      for (const team of teams) {
        const result = await emergencyTeamShutdown(projectDir, team.teamId);
        totalKilled += result.killed;
        totalCleaned += result.cleaned;
        logger.info(`  ${team.teamName}: killed ${result.killed}, cleaned ${result.cleaned}`);
      }
    }

    // Also kill any orphaned processes on gk ports (even if no team data)
    console.log();
    logger.info('Scanning for orphaned processes on ports 3377-3476...');
    const orphansKilled = await killOrphanedPortProcesses();
    totalKilled += orphansKilled;

    if (totalKilled === 0 && totalCleaned === 0) {
      logger.info('No processes found to kill.');
    } else {
      logger.success(`Total: ${totalKilled} process(es) killed, ${totalCleaned} member(s) cleaned up.`);
    }
    console.log();
    return;
  }

  // Kill specific team
  const team = getTeam(projectDir, teamId);
  if (!team) {
    console.log();
    logger.error(`Team not found: ${teamId}`);
    console.log();
    return;
  }

  console.log();
  logger.warn(`Emergency shutdown of team "${team.teamName}"...`);

  const result = await emergencyTeamShutdown(projectDir, teamId);

  logger.success(`Killed ${result.killed} process(es), cleaned up ${result.cleaned} member(s).`);
  console.log();
}

async function handleReset(projectDir: string) {
  console.log();
  logger.warn('This will delete ALL team data for this project!');
  logger.warn('Teams, tasks, messages, and port allocations will be removed.');
  console.log();

  // In a real CLI we'd prompt for confirmation
  // For now, just do it
  const success = deleteAllTeamData(projectDir);

  if (success) {
    logger.success('All team data deleted.');
  } else {
    logger.error('Failed to delete team data.');
  }
  console.log();
}

// ============================================================================
// NEW HANDLERS - Team/Task/Message Operations
// ============================================================================

// Store current agent context for CLI testing
let currentAgentId: string | null = null;
let currentAgentName: string | null = null;

function getAgentContext(options: { as?: string }): { agentId: string; agentName: string } {
  if (options.as) {
    return { agentId: `cli-${options.as}`, agentName: options.as };
  }
  if (currentAgentId && currentAgentName) {
    return { agentId: currentAgentId, agentName: currentAgentName };
  }
  // Default to leader
  currentAgentId = `cli-leader-${generateGkSessionId('cli-leader', process.pid).slice(0, 8)}`;
  currentAgentName = 'leader';
  return { agentId: currentAgentId, agentName: currentAgentName };
}

function getActiveTeamId(projectDir: string): string | null {
  const teams = listTeams(projectDir).filter(t => t.status === 'active');
  return teams.length > 0 ? teams[0].teamId : null;
}

async function handleCreate(projectDir: string, name: string | undefined, options: { desc?: string }) {
  if (!name) {
    logger.error('Team name required.');
    console.log(brand.dim('Usage: gk team create <name> [--desc "description"]'));
    return;
  }

  const { agentId, agentName } = getAgentContext({});
  const port = allocatePort(projectDir, agentId, 'pending');

  if (!port) {
    logger.error('No ports available');
    return;
  }

  const team = createTeam({
    teamName: name,
    description: options.desc || '',
    leaderId: agentId,
    leaderPort: port,
    projectDir
  });

  if (team) {
    console.log();
    logger.success(`Team created: ${team.teamName}`);
    console.log(`  Team ID: ${brand.primary(team.teamId)}`);
    console.log(`  Leader: ${agentName} (${agentId.slice(0, 16)}...)`);
    console.log(`  Port: ${port}`);
    console.log();
  } else {
    logger.error('Failed to create team.');
  }
}

async function handleAddMember(projectDir: string, name: string | undefined, options: { as?: string }) {
  if (!name) {
    logger.error('Member name required.');
    console.log(brand.dim('Usage: gk team add-member <name>'));
    return;
  }

  const teamId = getActiveTeamId(projectDir);
  if (!teamId) {
    logger.error('No active team. Create one first with: gk team create <name>');
    return;
  }

  const agentId = `cli-${name}-${generateGkSessionId('cli-member', process.pid).slice(0, 8)}`;
  const port = allocatePort(projectDir, agentId, teamId);

  if (!port) {
    logger.error('No ports available');
    return;
  }

  const added = addMemberToTeam(projectDir, teamId, {
    agentId,
    name,
    agentType: 'cli-agent',
    role: 'member',
    port,
    pid: null,
    status: 'ready'
  });

  if (added) {
    console.log();
    logger.success(`Added member: ${name}`);
    console.log(`  Agent ID: ${agentId.slice(0, 20)}...`);
    console.log(`  Port: ${port}`);
    console.log();
  } else {
    logger.error('Failed to add member.');
  }
}

async function handleTaskCreate(projectDir: string, subject: string | undefined, options: { desc?: string; blockedBy?: string }) {
  if (!subject) {
    logger.error('Task subject required.');
    console.log(brand.dim('Usage: gk team task-create <subject> [--desc "..."] [--blocked-by "id1,id2"]'));
    return;
  }

  const teamId = getActiveTeamId(projectDir);
  if (!teamId) {
    logger.error('No active team.');
    return;
  }

  const { agentName } = getAgentContext({});
  const blockedBy = options.blockedBy ? options.blockedBy.split(',').map(s => s.trim()) : undefined;

  const task = createTask(
    projectDir,
    teamId,
    subject,
    options.desc || subject,
    agentName,
    { blockedBy }
  );

  if (task) {
    console.log();
    logger.success(`Task created: ${task.subject}`);
    console.log(`  Task ID: ${brand.primary(task.taskId)}`);
    if (blockedBy && blockedBy.length > 0) {
      console.log(`  Blocked by: ${blockedBy.join(', ')}`);
    }
    console.log();
  } else {
    logger.error('Failed to create task.');
  }
}

async function handleTaskClaim(projectDir: string, taskId: string | undefined, options: { as?: string }) {
  if (!taskId) {
    logger.error('Task ID required.');
    console.log(brand.dim('Usage: gk team task-claim <taskId> [--as <agentName>]'));
    return;
  }

  const { agentName } = getAgentContext(options);

  const claimed = claimTask(projectDir, taskId, agentName);
  if (claimed) {
    logger.success(`${agentName} claimed task: ${taskId}`);
  } else {
    logger.error(`Failed to claim task: ${taskId}`);
  }
}

async function handleTaskDone(projectDir: string, taskId: string | undefined, options: { as?: string }) {
  if (!taskId) {
    logger.error('Task ID required.');
    console.log(brand.dim('Usage: gk team task-done <taskId>'));
    return;
  }

  const completed = await completeTask(projectDir, taskId);
  if (completed) {
    logger.success(`Task completed: ${taskId}`);
  } else {
    logger.error(`Failed to complete task: ${taskId}`);
  }
}

async function handleSend(projectDir: string, to: string | undefined, message: string | undefined, options: { as?: string }) {
  if (!to || !message) {
    logger.error('Recipient and message required.');
    console.log(brand.dim('Usage: gk team send <to> <message> [--as <sender>]'));
    return;
  }

  const teamId = getActiveTeamId(projectDir);
  if (!teamId) {
    logger.error('No active team.');
    return;
  }

  const team = getTeam(projectDir, teamId);
  if (!team) {
    logger.error('Team not found.');
    return;
  }

  const recipient = team.members.find(m => m.name === to);
  if (!recipient) {
    logger.error(`Member not found: ${to}`);
    console.log(`  Available: ${team.members.map(m => m.name).join(', ')}`);
    return;
  }

  const { agentId, agentName } = getAgentContext(options);

  const msg = await sendMessage(
    projectDir,
    teamId,
    agentId,
    agentName,
    recipient.agentId,
    recipient.name,
    message,
    message.slice(0, 50)
  );

  if (msg) {
    logger.success(`Message sent to ${to}`);
  } else {
    logger.error('Failed to send message.');
  }
}

async function handleBroadcast(projectDir: string, message: string | undefined, options: { as?: string }) {
  if (!message) {
    logger.error('Message required.');
    console.log(brand.dim('Usage: gk team broadcast <message> [--as <sender>]'));
    return;
  }

  const teamId = getActiveTeamId(projectDir);
  if (!teamId) {
    logger.error('No active team.');
    return;
  }

  const { agentId, agentName } = getAgentContext(options);

  const msgIds = await broadcast(
    projectDir,
    teamId,
    agentId,
    agentName,
    message,
    message.slice(0, 50)
  );

  logger.success(`Broadcast sent to ${msgIds.length} member(s)`);
}

// ============================================================================
// CENTRAL INBOX HANDLERS
// ============================================================================

/**
 * View central inbox with optional filters
 */
async function handleMessages(projectDir: string, options: {
  json?: boolean;
  pending?: boolean;
  type?: string;
  from?: string;
  to?: string;
  limit?: string;
}) {
  const teamId = getActiveTeamId(projectDir);
  if (!teamId) {
    logger.error('No active team.');
    return;
  }

  // Build filters
  const filters: InboxFilters = {};

  if (options.pending) {
    filters.status = 'pending';
  }

  if (options.type) {
    filters.type = options.type as MessageType;
  }

  if (options.from) {
    filters.from = options.from;
  }

  if (options.to) {
    filters.to = options.to;
  }

  if (options.limit) {
    filters.limit = parseInt(options.limit, 10);
  }

  const messages = readInbox(projectDir, teamId, filters);

  if (options.json) {
    console.log(JSON.stringify(messages, null, 2));
    return;
  }

  console.log();
  console.log(pc.bold(brand.geminiPurple('Team Inbox')));
  console.log();

  if (messages.length === 0) {
    console.log(brand.dim('  No messages found.'));
    console.log();
    return;
  }

  // Group by status for better display
  const pending = messages.filter(m => m.status === 'pending');
  const delivered = messages.filter(m => m.status === 'delivered');
  const processed = messages.filter(m => m.status === 'processed');

  if (pending.length > 0) {
    console.log(brand.warn(`  Pending (${pending.length}):`));
    for (const msg of pending.slice(-10)) {
      console.log(`    ${formatMessageForDisplay(msg)}`);
    }
    console.log();
  }

  if (delivered.length > 0 && !options.pending) {
    console.log(brand.primary(`  Delivered (${delivered.length}):`));
    for (const msg of delivered.slice(-5)) {
      console.log(`    ${formatMessageForDisplay(msg)}`);
    }
    console.log();
  }

  if (processed.length > 0 && !options.pending) {
    console.log(brand.success(`  Processed (${processed.length}):`));
    for (const msg of processed.slice(-5)) {
      console.log(`    ${formatMessageForDisplay(msg)}`);
    }
    console.log();
  }

  // Show hint for pending approvals
  const pendingApprovals = messages.filter(m => m.type === 'approval_request' && m.status === 'pending');
  if (pendingApprovals.length > 0) {
    console.log(brand.warn(`  💡 ${pendingApprovals.length} pending approval(s). Use:`));
    console.log(brand.dim(`     gk team respond <msgId> --approve`));
    console.log();
  }
}

/**
 * Respond to an approval request
 */
async function handleRespond(projectDir: string, messageId: string | undefined, options: {
  approve?: boolean;
  reject?: string;
  approveAll?: boolean;
}) {
  const teamId = getActiveTeamId(projectDir);
  if (!teamId) {
    logger.error('No active team.');
    return;
  }

  // Handle --approve-all
  if (options.approveAll) {
    const pendingApprovals = getPendingApprovals(projectDir, teamId);

    if (pendingApprovals.length === 0) {
      console.log();
      logger.info('No pending approval requests.');
      console.log();
      return;
    }

    console.log();
    logger.info(`Processing ${pendingApprovals.length} pending approval(s)...`);

    let approved = 0;
    let failed = 0;

    for (const msg of pendingApprovals) {
      const result = await validateAndApprove(projectDir, teamId, msg.id, true);
      if (result.success) {
        logger.success(`Approved: ${msg.summary}`);
        approved++;
      } else {
        logger.warn(`Failed: ${msg.summary} - ${result.error}`);
        failed++;
      }
    }

    console.log();
    logger.info(`Results: ${approved} approved, ${failed} failed`);
    console.log();
    return;
  }

  // Single message response
  if (!messageId) {
    console.log();
    logger.error('Message ID required.');
    console.log(brand.dim('Usage: gk team respond <messageId> --approve'));
    console.log(brand.dim('       gk team respond <messageId> --reject "reason"'));
    console.log(brand.dim('       gk team respond --approve-all'));
    console.log();
    return;
  }

  if (!options.approve && !options.reject) {
    console.log();
    logger.error('Must specify --approve or --reject "reason"');
    console.log();
    return;
  }

  const approved = options.approve === true;
  const reason = options.reject;

  const result = await validateAndApprove(projectDir, teamId, messageId, approved, reason);

  console.log();
  if (result.success) {
    if (approved) {
      logger.success(`Approved: ${result.action}`);
    } else {
      logger.info(`Rejected: ${result.action}`);
    }
  } else {
    logger.error(result.error || 'Failed to process response');
  }
  console.log();
}

// ============================================================================
// TEAM AGENT SPAWNING & INTERACTION HANDLERS
// ============================================================================

/**
 * Start an agent as a team member
 */
async function handleTeamStart(projectDir: string, options: {
  name?: string;
  role?: string;
  agent?: string;
  skills?: string;
  model?: string;
  tools?: string;
  context?: string;
  cli?: string;
}) {
  if (!options.name) {
    console.log();
    logger.error('Agent name required. Use --name <agentName>');
    console.log(brand.dim('Usage: gk team start --name <agentName> [options]'));
    console.log();
    process.exit(1);
  }

  const teamId = getActiveTeamId(projectDir);
  if (!teamId) {
    console.log();
    logger.error('No active team. Create one first: gk team create <name>');
    console.log();
    process.exit(1);
  }

  const team = getTeam(projectDir, teamId);
  if (!team) {
    logger.error('Team not found.');
    process.exit(1);
  }

  const cliProvider: CliProvider = (options.cli === 'claude') ? 'claude' : 'gemini';
  const config = loadConfig();

  const agentName = options.name;
  const role = (options.role === 'leader' ? 'leader' : 'member') as 'leader' | 'member';
  const agentId = generateGkSessionId(`team-${agentName}`, process.pid);

  // Load agent profile
  // Auto-derive from name if not specified (e.g., "researcher-1" → "researcher")
  let profile = null;
  const derivedRole = agentName.replace(/-\d+$/, '');  // Remove -N suffix
  const profileToLoad = options.agent || derivedRole;

  profile = loadAgentProfileWithFallback(profileToLoad, cliProvider);
  if (!profile && options.agent) {
    // Only error if explicitly specified but not found
    console.log();
    logger.error(`Agent profile not found: ${options.agent}`);
    console.log();
    process.exit(1);
  }
  // If auto-derived profile not found, continue without it (no error)

  // Determine model
  let model = options.model || profile?.model || config.spawn.defaultModel;
  model = mapModel(model, cliProvider);

  // Build tools list
  const cliTools = options.tools?.split(',').map(s => s.trim()).filter(Boolean) || [];
  const agentTools = profile?.tools || [];
  const mergedTools = [...new Set([...agentTools, ...cliTools])];
  const allTools = mapTools(mergedTools, cliProvider);

  // Build skills list
  const cliSkills = options.skills?.split(',').map(s => s.trim()).filter(Boolean) || [];
  const agentSkills = profile?.skills || [];
  const allSkills = [...new Set([...agentSkills, ...cliSkills])];

  const skillContents: Record<string, string> = {};
  for (const skill of allSkills) {
    const content = loadSkillContent(skill);
    if (content) skillContents[skill] = content;
  }

  // Load context files
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

  // Allocate port
  const port = allocatePort(projectDir, agentId, teamId);
  if (!port) {
    console.log();
    logger.error('No ports available for team member');
    console.log();
    process.exit(1);
  }

  // Add member to team
  const added = addMemberToTeam(projectDir, teamId, {
    agentId,
    name: agentName,
    agentType: options.agent || 'default',
    role,
    port,
    pid: null,
    status: 'starting'
  });

  if (!added) {
    releasePort(projectDir, agentId);
    console.log();
    logger.error('Failed to register in team');
    console.log();
    process.exit(1);
  }

  // Create session state
  const sessionState: PtySessionState = {
    provider: cliProvider,
    model,
    port,
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
    team: {
      teamId,
      teamName: team.teamName,
      role,
      agentId,
      agentName,
      leaderPort: team.leaderPort,
      projectDir
    },
    startedAt: new Date().toISOString()
  };

  // Save session with agent-specific filename
  saveSession(sessionState, undefined, agentName);

  console.log();
  logger.info(`Starting ${brand.primary(agentName)} in team ${brand.dim(team.teamName)}...`);
  logger.info(`Provider: ${brand.primary(cliProvider)}, Model: ${brand.primary(model)}`);
  logger.info(`Port: ${brand.dim(port.toString())}`);
  if (profile) {
    const autoNote = !options.agent ? ' (auto-derived)' : '';
    logger.info(`Agent: ${brand.dim(profile.name)}${brand.dim(autoNote)}`);
  }
  if (allSkills.length > 0) {
    logger.info(`Skills: ${brand.dim(allSkills.join(', '))}`);
  }
  if (contextFiles.length > 0) {
    logger.info(`Context: ${brand.dim(contextFiles.map(c => c.name).join(', '))}`);
  }
  if (allTools.length > 0) {
    logger.info(`Tools: ${brand.dim(allTools.join(', '))}`);
  }
  console.log();

  // Build environment for server process
  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GK_TEAM_ID: teamId,
    GK_TEAM_NAME: team.teamName,
    GK_TEAM_ROLE: role,
    GK_TEAM_PORT: port.toString(),
    GK_TEAM_LEADER_PORT: team.leaderPort.toString(),
    GK_AGENT_NAME: agentName,
    GK_SUB_SESSION_ID: agentId
  };

  // Spawn server as DETACHED background process
  const scriptPath = process.argv[1];
  const serverProcess = spawn(process.execPath, [scriptPath, 'team', '_server'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: process.cwd(),
    env: serverEnv
  });

  serverProcess.unref();

  // Update session with server PID
  sessionState.pid = serverProcess.pid || 0;
  saveSession(sessionState, undefined, agentName);

  // Update team member status and PID
  if (serverProcess.pid) {
    updateMemberPid(projectDir, teamId, agentId, serverProcess.pid);
    updateMemberStatus(projectDir, teamId, agentId, 'ready');
  }

  logger.info(`Server started (PID: ${serverProcess.pid})`);
  logger.info('Waiting for AI to initialize...');

  // Poll for server to be ready
  const client = new PtyClient(port);
  const maxAttempts = 120;

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(1000);
    try {
      const status = await client.status();
      if (status.ready) {
        console.log();
        logger.success(`${agentName} ready!`);
        console.log();
        console.log('Monitor:');
        console.log(`  ${brand.dim(`gk team messages --pending`)}`);
        console.log(`  ${brand.dim(`gk team respond <msgId> --approve`)}`);
        console.log(`  ${brand.dim(`gk team respond --approve-all`)}`);
        console.log(`  ${brand.dim(`gk team exchange ${agentName}`)}`);
        console.log();
        console.log('Send messages:');
        console.log(`  ${brand.dim(`gk team send ${agentName} "your message"`)}`);
        console.log();
        return;
      }
    } catch {
      // Server not ready yet
    }
    process.stdout.write('.');
  }

  console.log();
  logger.warn('Server started but AI may still be initializing.');
  console.log();
}

/**
 * Internal server handler for team mode
 */
async function handleTeamServerInternal() {
  const agentName = process.env.GK_AGENT_NAME;
  if (!agentName) {
    console.error('[TeamServer] No agent name in environment');
    process.exit(1);
  }

  const session = loadSession(undefined, agentName);
  if (!session) {
    console.error('[TeamServer] No session state found');
    process.exit(1);
  }

  // Import PtyServer dynamically to avoid circular deps
  const { PtyServer } = await import('../../services/pty-server.js');

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
    console.error(`[TeamServer] Failed to start: ${(err as Error).message}`);
    clearSession(undefined, agentName);
    process.exit(1);
  }

  // Handle shutdown signals
  process.on('SIGINT', async () => {
    await server.stop();
    clearSession(undefined, agentName);
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    clearSession(undefined, agentName);
    process.exit(0);
  });
}

/**
 * Get structured exchange output from a team agent
 */
async function handleTeamExchange(projectDir: string, agentName: string | undefined, options: { json?: boolean }) {
  if (!agentName) {
    console.log();
    logger.error('Agent name required.');
    console.log(brand.dim('Usage: gk team exchange <agentName>'));
    console.log();
    process.exit(1);
  }

  const port = getAgentPort(projectDir, agentName);
  if (!port) {
    logger.error(`Agent not found or not running: ${agentName}`);
    process.exit(1);
  }

  const client = new PtyClient(port);

  try {
    const exchange = await client.exchange();
    console.log(JSON.stringify(exchange, null, 2));
  } catch (err) {
    logger.error((err as Error).message);
    process.exit(1);
  }
}

/**
 * Read raw output from a team agent
 */
async function handleTeamRead(projectDir: string, agentName: string | undefined) {
  if (!agentName) {
    console.log();
    logger.error('Agent name required.');
    console.log(brand.dim('Usage: gk team read <agentName>'));
    console.log();
    process.exit(1);
  }

  const port = getAgentPort(projectDir, agentName);
  if (!port) {
    logger.error(`Agent not found or not running: ${agentName}`);
    process.exit(1);
  }

  const client = new PtyClient(port);

  try {
    const output = await client.read(200);
    console.log(output);
  } catch (err) {
    logger.error((err as Error).message);
    process.exit(1);
  }
}

/**
 * Helper: Get agent port by name
 */
function getAgentPort(projectDir: string, agentName: string): number | null {
  const teamId = getActiveTeamId(projectDir);
  if (!teamId) return null;

  const team = getTeam(projectDir, teamId);
  if (!team) return null;

  const member = team.members.find(m => m.name === agentName);
  return member?.port ?? null;
}

/**
 * Helper: Sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper: Load context file (aligned with gk agent start)
 */
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
