/**
 * Shutdown Manager - Handles graceful and emergency shutdown of team members
 *
 * Features:
 * - Tracks pending shutdown requests with timeouts
 * - Force kills unresponsive members after timeout
 * - Cleans up orphaned processes on startup
 */

import { execSync } from 'child_process';
import {
  GkTeam,
  TeamMember,
  InboxMessage
} from './types.js';
import { getTeam, listTeams } from './manager.js';
import { updateMemberStatus } from './writer.js';
import { sendShutdownRequest } from './message-broker.js';
import { releasePort, getTeamPorts, cleanupStalePorts } from './port-manager.js';
import { readInbox, updateInboxMessage } from './inbox.js';
import { generateUniqueId } from '../../services/hash.js';

// Default timeout for shutdown response (30 seconds)
const SHUTDOWN_TIMEOUT_MS = 30000;

// Polling interval for checking shutdown responses
const SHUTDOWN_POLL_INTERVAL_MS = 2000;

// Track pending shutdown requests
interface PendingShutdown {
  requestId: string;
  agentId: string;
  agentName: string;
  teamId: string;
  projectDir: string;
  pid: number | null;
  startedAt: number;
  timeoutMs: number;
}

const pendingShutdowns: Map<string, PendingShutdown> = new Map();

/**
 * Check if a process is running by PID
 * Uses Node.js native process.kill(pid, 0) which works cross-platform
 */
function isProcessRunning(pid: number): boolean {
  if (!pid || pid <= 0) return false;

  try {
    // Signal 0 checks if process exists without killing it
    // Works on both Windows and Unix in Node.js
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Force kill a process by PID
 * Uses taskkill on Windows (via cmd.exe), SIGKILL on Unix
 */
function forceKillProcess(pid: number): boolean {
  if (!pid || pid <= 0) return false;

  try {
    if (process.platform === 'win32') {
      // Use cmd.exe to run taskkill (works regardless of shell environment)
      execSync(`cmd.exe /c taskkill /F /PID ${pid}`, {
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

/**
 * Request graceful shutdown of a team member
 * Returns the request ID for tracking
 */
export async function requestMemberShutdown(
  projectDir: string,
  teamId: string,
  leaderId: string,
  leaderName: string,
  targetAgentId: string,
  targetName: string,
  reason: string = 'Task complete',
  timeoutMs: number = SHUTDOWN_TIMEOUT_MS
): Promise<{ requestId: string; sent: boolean }> {
  const team = getTeam(projectDir, teamId);
  if (!team) {
    return { requestId: '', sent: false };
  }

  const member = team.members.find(m => m.agentId === targetAgentId);
  if (!member) {
    return { requestId: '', sent: false };
  }

  // Send shutdown request
  const result = await sendShutdownRequest(
    projectDir,
    teamId,
    leaderId,
    leaderName,
    targetAgentId,
    targetName,
    reason
  );

  if (!result) {
    return { requestId: '', sent: false };
  }

  // Track the pending shutdown
  const pending: PendingShutdown = {
    requestId: result.requestId,
    agentId: targetAgentId,
    agentName: targetName,
    teamId,
    projectDir,
    pid: member.pid,
    startedAt: Date.now(),
    timeoutMs
  };

  pendingShutdowns.set(result.requestId, pending);

  // Start timeout checker
  startShutdownTimeoutChecker(result.requestId);

  return { requestId: result.requestId, sent: true };
}

/**
 * Start a timeout checker for a shutdown request
 */
function startShutdownTimeoutChecker(requestId: string): void {
  const checkTimeout = () => {
    const pending = pendingShutdowns.get(requestId);
    if (!pending) {
      return; // Already handled
    }

    const elapsed = Date.now() - pending.startedAt;

    // Check if member responded (check central inbox)
    const messages = readInbox(pending.projectDir, pending.teamId, {
      type: 'shutdown_response',
      status: 'pending'
    });
    const response = messages.find((m: InboxMessage) =>
      m.metadata?.requestId === requestId
    );

    if (response) {
      // Got response - handle it
      handleShutdownResponse(requestId, response);
      return;
    }

    // Check if timeout exceeded
    if (elapsed >= pending.timeoutMs) {
      // Force kill
      forceShutdownMember(requestId);
      return;
    }

    // Check if process already dead
    if (pending.pid && !isProcessRunning(pending.pid)) {
      // Process already dead, clean up
      cleanupAfterShutdown(pending);
      pendingShutdowns.delete(requestId);
      return;
    }

    // Continue checking
    setTimeout(checkTimeout, SHUTDOWN_POLL_INTERVAL_MS);
  };

  // Start checking after a short delay
  setTimeout(checkTimeout, SHUTDOWN_POLL_INTERVAL_MS);
}

/**
 * Handle a shutdown response from a member
 */
function handleShutdownResponse(requestId: string, response: InboxMessage): void {
  const pending = pendingShutdowns.get(requestId);
  if (!pending) {
    return;
  }

  // Mark the message as processed
  updateInboxMessage(pending.projectDir, pending.teamId, response.id, {
    status: 'processed',
    processedAt: new Date().toISOString()
  });

  if (response.metadata?.approved) {
    // Member approved shutdown - they should exit on their own
    // Wait a bit then verify they're gone
    setTimeout(() => {
      if (pending.pid && isProcessRunning(pending.pid)) {
        // Still running after approval - force kill
        console.log(`[Shutdown] Member ${pending.agentName} approved but still running, forcing kill`);
        forceKillProcess(pending.pid);
      }
      cleanupAfterShutdown(pending);
      pendingShutdowns.delete(requestId);
    }, 5000);
  } else {
    // Member rejected shutdown - remove from pending but don't kill
    console.log(`[Shutdown] Member ${pending.agentName} rejected shutdown: ${response.content}`);
    pendingShutdowns.delete(requestId);
  }
}

/**
 * Force shutdown a member after timeout
 */
function forceShutdownMember(requestId: string): void {
  const pending = pendingShutdowns.get(requestId);
  if (!pending) {
    return;
  }

  console.log(`[Shutdown] Timeout for ${pending.agentName}, forcing shutdown`);

  // Force kill if we have a PID
  if (pending.pid) {
    const killed = forceKillProcess(pending.pid);
    if (killed) {
      console.log(`[Shutdown] Force killed PID ${pending.pid}`);
    } else {
      console.log(`[Shutdown] Failed to kill PID ${pending.pid} (may already be dead)`);
    }
  }

  // Cleanup
  cleanupAfterShutdown(pending);
  pendingShutdowns.delete(requestId);
}

/**
 * Cleanup after a member shutdown
 */
function cleanupAfterShutdown(pending: PendingShutdown): void {
  // Update member status
  updateMemberStatus(pending.projectDir, pending.teamId, pending.agentId, 'shutdown');

  // Release port
  releasePort(pending.projectDir, pending.agentId);
}

/**
 * Request shutdown of all team members
 */
export async function requestTeamShutdown(
  projectDir: string,
  teamId: string,
  leaderId: string,
  leaderName: string,
  reason: string = 'Team shutdown',
  timeoutMs: number = SHUTDOWN_TIMEOUT_MS
): Promise<{ total: number; requested: number; requestIds: string[] }> {
  const team = getTeam(projectDir, teamId);
  if (!team) {
    return { total: 0, requested: 0, requestIds: [] };
  }

  const requestIds: string[] = [];
  let requested = 0;

  // Request shutdown for all non-leader members
  for (const member of team.members) {
    if (member.agentId === leaderId) {
      continue; // Skip leader
    }

    if (member.status === 'shutdown') {
      continue; // Already shutdown
    }

    const result = await requestMemberShutdown(
      projectDir,
      teamId,
      leaderId,
      leaderName,
      member.agentId,
      member.name,
      reason,
      timeoutMs
    );

    if (result.sent) {
      requestIds.push(result.requestId);
      requested++;
    }
  }

  return {
    total: team.members.length - 1, // Exclude leader
    requested,
    requestIds
  };
}

/**
 * Wait for all shutdown requests to complete
 */
export async function waitForShutdowns(
  requestIds: string[],
  maxWaitMs: number = SHUTDOWN_TIMEOUT_MS + 10000
): Promise<{ completed: number; timedOut: number; failed: number }> {
  const startTime = Date.now();
  let completed = 0;
  let timedOut = 0;
  let failed = 0;

  while (Date.now() - startTime < maxWaitMs) {
    let allDone = true;

    for (const requestId of requestIds) {
      if (pendingShutdowns.has(requestId)) {
        allDone = false;
      }
    }

    if (allDone) {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Count results
  for (const requestId of requestIds) {
    if (pendingShutdowns.has(requestId)) {
      timedOut++;
    } else {
      completed++;
    }
  }

  return { completed, timedOut, failed };
}

/**
 * Cleanup orphaned team members (processes that died without proper shutdown)
 */
export async function cleanupOrphanedMembers(projectDir: string): Promise<{
  teamsChecked: number;
  membersChecked: number;
  orphansFound: number;
  cleaned: number;
}> {
  const teams = listTeams(projectDir);
  let membersChecked = 0;
  let orphansFound = 0;
  let cleaned = 0;

  for (const team of teams) {
    for (const member of team.members) {
      membersChecked++;

      // Skip already shutdown members
      if (member.status === 'shutdown') {
        continue;
      }

      // Check if process is still running
      if (member.pid && !isProcessRunning(member.pid)) {
        orphansFound++;

        // Mark as shutdown and release port
        updateMemberStatus(projectDir, team.teamId, member.agentId, 'shutdown');
        releasePort(projectDir, member.agentId);
        cleaned++;
      }
    }
  }

  // Also cleanup stale ports
  const stalePorts = await cleanupStalePorts(projectDir);

  return {
    teamsChecked: teams.length,
    membersChecked,
    orphansFound,
    cleaned: cleaned + stalePorts
  };
}

/**
 * Force shutdown all members of a team immediately (emergency)
 */
export async function emergencyTeamShutdown(
  projectDir: string,
  teamId: string
): Promise<{ killed: number; cleaned: number }> {
  const team = getTeam(projectDir, teamId);
  if (!team) {
    return { killed: 0, cleaned: 0 };
  }

  let killed = 0;
  let cleaned = 0;

  for (const member of team.members) {
    if (member.status === 'shutdown') {
      continue;
    }

    // Force kill if running
    if (member.pid && isProcessRunning(member.pid)) {
      if (forceKillProcess(member.pid)) {
        killed++;
      }
    }

    // Cleanup
    updateMemberStatus(projectDir, teamId, member.agentId, 'shutdown');
    releasePort(projectDir, member.agentId);
    cleaned++;
  }

  return { killed, cleaned };
}

/**
 * Get pending shutdown count
 */
export function getPendingShutdownCount(): number {
  return pendingShutdowns.size;
}

/**
 * Get pending shutdown details
 */
export function getPendingShutdowns(): Array<{
  requestId: string;
  agentName: string;
  elapsedMs: number;
  timeoutMs: number;
}> {
  const now = Date.now();
  return Array.from(pendingShutdowns.values()).map(p => ({
    requestId: p.requestId,
    agentName: p.agentName,
    elapsedMs: now - p.startedAt,
    timeoutMs: p.timeoutMs
  }));
}

/**
 * Cancel a pending shutdown request
 */
export function cancelShutdownRequest(requestId: string): boolean {
  return pendingShutdowns.delete(requestId);
}
