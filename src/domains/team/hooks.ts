/**
 * Inbox Hooks - Auto-triggered actions based on message type
 *
 * When a message is written to the inbox, hooks process it:
 * - approval_response → Send "1"/"3" to agent PTY
 * - task_completed → Unblock dependent tasks, notify downstream
 * - shutdown_response → Kill agent process if approved
 */

import type { InboxMessage, HookResult, TeamTask } from './types.js';
import { getInboxMessage, updateInboxMessage, writeTaskCompleted, writeBroadcast, createLeaderRef } from './inbox.js';
import { getTeam, getTask, listTeamTasks } from './manager.js';
import { updateTask } from './writer.js';
import { updateMemberStatus, removeMember } from './writer.js';
import { releasePort } from './port-manager.js';
import { PtyClient } from '../../services/pty-client.js';

// ============================================================================
// Main Hook Processor
// ============================================================================

/**
 * Process hooks for a newly written message
 * Call this after writing to inbox
 */
export async function processMessageHook(
  projectDir: string,
  teamId: string,
  message: InboxMessage
): Promise<HookResult> {
  switch (message.type) {
    case 'approval_response':
      return handleApprovalResponse(projectDir, teamId, message);

    case 'task_completed':
      return handleTaskCompleted(projectDir, teamId, message);

    case 'shutdown_response':
      return handleShutdownResponse(projectDir, teamId, message);

    case 'message':
    case 'broadcast':
      // These are handled by PtyServer polling, no immediate hook action
      return { success: true, action: 'Queued for delivery' };

    default:
      return { success: true, action: 'No hook action needed' };
  }
}

// ============================================================================
// Hook Handlers
// ============================================================================

/**
 * Handle approval response - send approval/rejection to agent PTY
 */
async function handleApprovalResponse(
  projectDir: string,
  teamId: string,
  message: InboxMessage
): Promise<HookResult> {
  const { requestId, approved } = message.metadata || {};

  if (!requestId) {
    return { success: false, error: 'No requestId in approval response' };
  }

  // Find original request to get agent port
  const originalRequest = getInboxMessage(projectDir, teamId, requestId);
  if (!originalRequest) {
    return { success: false, error: `Original request not found: ${requestId}` };
  }

  const agentPort = originalRequest.metadata?.agentPort;
  if (!agentPort) {
    return { success: false, error: 'No agent port in original request' };
  }

  try {
    const client = new PtyClient(agentPort);

    if (approved) {
      // Send "1" to approve
      await client.send('1');

      // Update original request status
      updateInboxMessage(projectDir, teamId, requestId, {
        status: 'processed',
        processedAt: new Date().toISOString()
      });

      return { success: true, action: `Sent approval to PTY port ${agentPort}` };
    } else {
      // Send "3" to reject/suggest changes
      await client.send('3');

      // Update original request status
      updateInboxMessage(projectDir, teamId, requestId, {
        status: 'processed',
        processedAt: new Date().toISOString()
      });

      return { success: true, action: `Sent rejection to PTY port ${agentPort}` };
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to send to PTY: ${(error as Error).message}`
    };
  }
}

/**
 * Handle task completed - unblock dependent tasks
 */
async function handleTaskCompleted(
  projectDir: string,
  teamId: string,
  message: InboxMessage
): Promise<HookResult> {
  const { taskId } = message.metadata || {};

  if (!taskId) {
    return { success: false, error: 'No taskId in task_completed message' };
  }

  // Find tasks that were blocked by this one
  const allTasks = listTeamTasks(projectDir, teamId);
  const unblockedTasks: string[] = [];

  for (const task of allTasks) {
    if (task.blockedBy && task.blockedBy.includes(taskId)) {
      // Remove completed task from blockedBy using removeBlockedBy
      updateTask(projectDir, task.taskId, {
        removeBlockedBy: [taskId]
      });

      // Re-fetch task to check if fully unblocked
      const updatedTask = getTask(projectDir, task.taskId);

      // If no more blockers, task is now available
      if (updatedTask && updatedTask.blockedBy.length === 0 && updatedTask.status === 'pending') {
        unblockedTasks.push(task.taskId);
      }
    }
  }

  // Notify about unblocked tasks
  if (unblockedTasks.length > 0) {
    const unblockedTasksInfo = unblockedTasks.map(id => {
      const t = getTask(projectDir, id);
      return t ? `${id}: ${t.subject}` : id;
    });

    writeBroadcast(
      projectDir,
      teamId,
      createLeaderRef('system'),
      `Tasks now available:\n${unblockedTasksInfo.join('\n')}`,
      `${unblockedTasks.length} task(s) unblocked`
    );

    return {
      success: true,
      action: `Unblocked ${unblockedTasks.length} task(s): ${unblockedTasks.join(', ')}`
    };
  }

  return { success: true, action: 'No tasks to unblock' };
}

/**
 * Handle shutdown response - kill agent process if approved
 */
async function handleShutdownResponse(
  projectDir: string,
  teamId: string,
  message: InboxMessage
): Promise<HookResult> {
  const { approved } = message.metadata || {};

  if (!approved) {
    return { success: true, action: 'Shutdown declined by agent' };
  }

  // Find the agent that sent this response
  const agentName = message.from.name;
  const team = getTeam(projectDir, teamId);

  if (!team) {
    return { success: false, error: 'Team not found' };
  }

  const member = team.members.find(m => m.name === agentName);
  if (!member) {
    return { success: false, error: `Member not found: ${agentName}` };
  }

  // Kill the process if running
  if (member.pid) {
    try {
      process.kill(member.pid);
    } catch (error) {
      // Process may already be dead, continue with cleanup
    }
  }

  // Update member status
  updateMemberStatus(projectDir, teamId, member.agentId, 'shutdown');

  // Release port
  releasePort(projectDir, member.agentId);

  return {
    success: true,
    action: `Shutdown ${agentName} (PID: ${member.pid})`
  };
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate that an approval request can be approved
 * Returns null if valid, error message if invalid
 */
export async function validateApprovalRequest(
  projectDir: string,
  teamId: string,
  messageId: string
): Promise<{ valid: boolean; error?: string; message?: InboxMessage }> {
  // 1. Find message
  const message = getInboxMessage(projectDir, teamId, messageId);
  if (!message) {
    return { valid: false, error: `Request not found: ${messageId}` };
  }

  // 2. Validate type
  if (message.type !== 'approval_request') {
    return {
      valid: false,
      error: `Cannot approve: type is '${message.type}', not 'approval_request'`
    };
  }

  // 3. Check status
  if (message.status !== 'pending') {
    return {
      valid: false,
      error: `Request already ${message.status}${message.processedAt ? ` at ${message.processedAt}` : ''}`
    };
  }

  // 4. Verify agent still has pending tool
  const agentPort = message.metadata?.agentPort;
  if (!agentPort) {
    return { valid: false, error: 'No agent port in request metadata' };
  }

  try {
    const client = new PtyClient(agentPort);
    const pending = await client.pending();

    if (!pending.hasPending) {
      // Mark as stale
      updateInboxMessage(projectDir, teamId, messageId, { status: 'stale' });
      return {
        valid: false,
        error: `Agent has no pending tool (request marked stale)`
      };
    }
  } catch (error) {
    return {
      valid: false,
      error: `Cannot reach agent: ${(error as Error).message}`
    };
  }

  return { valid: true, message };
}

/**
 * Validate and approve a request in one step
 */
export async function validateAndApprove(
  projectDir: string,
  teamId: string,
  messageId: string,
  approved: boolean,
  reason?: string
): Promise<HookResult> {
  const validation = await validateApprovalRequest(projectDir, teamId, messageId);

  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const message = validation.message!;

  // Write approval response
  const { writeApprovalResponse } = await import('./inbox.js');
  const response = writeApprovalResponse(
    projectDir,
    teamId,
    message.from,
    messageId,
    approved,
    reason
  );

  // Process the hook (sends to PTY)
  return processMessageHook(projectDir, teamId, response);
}
