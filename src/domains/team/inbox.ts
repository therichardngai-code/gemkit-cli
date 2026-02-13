/**
 * Central Inbox for Team Communications
 * All messages flow through this unified inbox:
 * - Direct messages, broadcasts
 * - Approval requests/responses
 * - Task updates
 * - Status updates
 * - Shutdown requests/responses
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import type {
  InboxMessage,
  InboxFilters,
  MessageType,
  AgentRef,
  TeamRole,
  MemberStatus
} from './types.js';
import { getTeamsDir, getInboxPath, ensureDir } from './storage.js';

// ============================================================================
// Core Inbox Functions
// ============================================================================

/**
 * Generate a unique message ID
 */
function generateMessageId(type: MessageType): string {
  const prefix = type.replace(/_/g, '-');
  const suffix = randomUUID().slice(0, 8);
  return `${prefix}-${suffix}`;
}

/**
 * Ensure inbox file exists
 */
function ensureInboxExists(projectDir: string, teamId: string): string {
  const teamsDir = getTeamsDir(projectDir);
  ensureDir(teamsDir);
  const inboxPath = getInboxPath(projectDir, teamId);
  if (!existsSync(inboxPath)) {
    // Create empty file
    appendFileSync(inboxPath, '');
  }
  return inboxPath;
}

/**
 * Write a message to the central inbox
 */
export function writeInbox(
  projectDir: string,
  teamId: string,
  message: Omit<InboxMessage, 'id' | 'timestamp'>
): InboxMessage {
  const inboxPath = ensureInboxExists(projectDir, teamId);

  const fullMessage: InboxMessage = {
    id: generateMessageId(message.type),
    timestamp: new Date().toISOString(),
    ...message
  };

  // Append to JSONL file (one JSON object per line)
  const line = JSON.stringify(fullMessage) + '\n';
  appendFileSync(inboxPath, line, 'utf-8');

  return fullMessage;
}

/**
 * Read all messages from inbox (with optional filters)
 */
export function readInbox(
  projectDir: string,
  teamId: string,
  filters?: InboxFilters
): InboxMessage[] {
  const inboxPath = getInboxPath(projectDir, teamId);

  if (!existsSync(inboxPath)) {
    return [];
  }

  const content = readFileSync(inboxPath, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim());

  let messages: InboxMessage[] = lines.map(line => {
    try {
      return JSON.parse(line) as InboxMessage;
    } catch {
      return null;
    }
  }).filter((msg): msg is InboxMessage => msg !== null);

  // Apply filters
  if (filters) {
    if (filters.to) {
      messages = messages.filter(msg =>
        msg.to === 'all' ||
        (typeof msg.to === 'object' && msg.to.name === filters.to)
      );
    }

    if (filters.from) {
      messages = messages.filter(msg => msg.from.name === filters.from);
    }

    if (filters.type) {
      const types = Array.isArray(filters.type) ? filters.type : [filters.type];
      messages = messages.filter(msg => types.includes(msg.type));
    }

    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      messages = messages.filter(msg => statuses.includes(msg.status));
    }

    if (filters.since) {
      const sinceDate = new Date(filters.since);
      messages = messages.filter(msg => new Date(msg.timestamp) >= sinceDate);
    }

    if (filters.limit && filters.limit > 0) {
      messages = messages.slice(-filters.limit);
    }
  }

  return messages;
}

/**
 * Get a specific message by ID
 */
export function getInboxMessage(
  projectDir: string,
  teamId: string,
  messageId: string
): InboxMessage | null {
  const messages = readInbox(projectDir, teamId);
  return messages.find(msg => msg.id === messageId) || null;
}

/**
 * Update a message in the inbox
 * Note: JSONL is append-only, so we rewrite the file with updated content
 */
export function updateInboxMessage(
  projectDir: string,
  teamId: string,
  messageId: string,
  updates: Partial<Pick<InboxMessage, 'status' | 'deliveredAt' | 'processedAt' | 'metadata'>>
): boolean {
  const inboxPath = getInboxPath(projectDir, teamId);

  if (!existsSync(inboxPath)) {
    return false;
  }

  const content = readFileSync(inboxPath, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim());

  let found = false;
  const updatedLines = lines.map(line => {
    try {
      const msg = JSON.parse(line) as InboxMessage;
      if (msg.id === messageId) {
        found = true;
        const updatedMsg = {
          ...msg,
          ...updates,
          metadata: { ...msg.metadata, ...updates.metadata }
        };
        return JSON.stringify(updatedMsg);
      }
      return line;
    } catch {
      return line;
    }
  });

  if (found) {
    const newContent = updatedLines.join('\n') + '\n';
    writeFileSync(inboxPath, newContent, 'utf-8');
  }

  return found;
}

/**
 * Get pending messages for a specific agent
 * Returns messages where:
 * - to.name matches agentName OR to === 'all'
 * - status is 'pending'
 */
export function getPendingForAgent(
  projectDir: string,
  teamId: string,
  agentName: string
): InboxMessage[] {
  return readInbox(projectDir, teamId, {
    status: 'pending'
  }).filter(msg =>
    msg.to === 'all' ||
    (typeof msg.to === 'object' && msg.to.name === agentName)
  );
}

/**
 * Get pending approval requests (for leader)
 */
export function getPendingApprovals(
  projectDir: string,
  teamId: string
): InboxMessage[] {
  return readInbox(projectDir, teamId, {
    type: 'approval_request',
    status: 'pending'
  });
}

/**
 * Get all pending items (approvals + undelivered messages)
 */
export function getAllPending(
  projectDir: string,
  teamId: string
): InboxMessage[] {
  return readInbox(projectDir, teamId, {
    status: 'pending'
  });
}

// ============================================================================
// Helper Functions for Creating Messages
// ============================================================================

/**
 * Create an agent reference
 */
export function createAgentRef(
  id: string,
  name: string,
  role: TeamRole = 'member'
): AgentRef {
  return { id, name, role };
}

/**
 * Create leader reference
 */
export function createLeaderRef(id: string = 'leader'): AgentRef {
  return { id, name: 'leader', role: 'leader' };
}

/**
 * Write a direct message to inbox
 */
export function writeMessage(
  projectDir: string,
  teamId: string,
  from: AgentRef,
  to: AgentRef,
  content: string,
  summary: string
): InboxMessage {
  return writeInbox(projectDir, teamId, {
    type: 'message',
    from,
    to,
    content,
    summary,
    status: 'pending'
  });
}

/**
 * Write a broadcast message to inbox
 */
export function writeBroadcast(
  projectDir: string,
  teamId: string,
  from: AgentRef,
  content: string,
  summary: string
): InboxMessage {
  return writeInbox(projectDir, teamId, {
    type: 'broadcast',
    from,
    to: 'all',
    content,
    summary,
    status: 'pending'
  });
}

/**
 * Write an approval request to inbox
 */
export function writeApprovalRequest(
  projectDir: string,
  teamId: string,
  from: AgentRef,
  toolType: string,
  toolDetail: string,
  agentPort: number
): InboxMessage {
  return writeInbox(projectDir, teamId, {
    type: 'approval_request',
    from,
    to: createLeaderRef(),
    content: `Tool approval needed: ${toolType}\n${toolDetail}`,
    summary: `${toolType}: ${toolDetail.slice(0, 50)}`,
    status: 'pending',
    metadata: {
      toolType,
      toolDetail,
      agentPort
    }
  });
}

/**
 * Write an approval response to inbox
 */
export function writeApprovalResponse(
  projectDir: string,
  teamId: string,
  to: AgentRef,
  requestId: string,
  approved: boolean,
  reason?: string
): InboxMessage {
  return writeInbox(projectDir, teamId, {
    type: 'approval_response',
    from: createLeaderRef(),
    to,
    content: approved ? 'Approved' : `Rejected: ${reason || 'No reason provided'}`,
    summary: approved ? 'Approved' : 'Rejected',
    status: 'processed',
    metadata: {
      requestId,
      approved,
      reason
    }
  });
}

/**
 * Write a task created message to inbox
 */
export function writeTaskCreated(
  projectDir: string,
  teamId: string,
  from: AgentRef,
  taskId: string,
  subject: string,
  blockedBy?: string[]
): InboxMessage {
  return writeInbox(projectDir, teamId, {
    type: 'task_created',
    from,
    to: 'all',
    content: `New task: ${subject}`,
    summary: `Task created: ${subject.slice(0, 40)}`,
    status: 'pending',
    metadata: {
      taskId,
      blockedBy
    }
  });
}

/**
 * Write a task claimed message to inbox
 */
export function writeTaskClaimed(
  projectDir: string,
  teamId: string,
  from: AgentRef,
  taskId: string,
  subject: string
): InboxMessage {
  return writeInbox(projectDir, teamId, {
    type: 'task_claimed',
    from,
    to: 'all',
    content: `${from.name} claimed: ${subject}`,
    summary: `${from.name} claimed task`,
    status: 'pending',
    metadata: {
      taskId
    }
  });
}

/**
 * Write a task completed message to inbox
 */
export function writeTaskCompleted(
  projectDir: string,
  teamId: string,
  from: AgentRef,
  taskId: string,
  subject: string
): InboxMessage {
  return writeInbox(projectDir, teamId, {
    type: 'task_completed',
    from,
    to: 'all',
    content: `${from.name} completed: ${subject}`,
    summary: `${from.name} completed task`,
    status: 'pending',
    metadata: {
      taskId
    }
  });
}

/**
 * Write a status update to inbox
 */
export function writeStatusUpdate(
  projectDir: string,
  teamId: string,
  from: AgentRef,
  previousStatus: string,
  newStatus: string
): InboxMessage {
  return writeInbox(projectDir, teamId, {
    type: 'status_update',
    from,
    to: createLeaderRef(),
    content: `${from.name} status: ${previousStatus} → ${newStatus}`,
    summary: `Status: ${newStatus}`,
    status: 'processed',
    metadata: {
      previousStatus: previousStatus as any,
      newStatus: newStatus as any
    }
  });
}

/**
 * Write a shutdown request to inbox
 */
export function writeShutdownRequest(
  projectDir: string,
  teamId: string,
  to: AgentRef,
  reason?: string
): InboxMessage {
  const requestId = randomUUID().slice(0, 8);
  return writeInbox(projectDir, teamId, {
    type: 'shutdown_request',
    from: createLeaderRef(),
    to,
    content: reason || 'Shutdown requested by leader',
    summary: 'Shutdown request',
    status: 'pending',
    metadata: {
      requestId
    }
  });
}

/**
 * Write a shutdown response to inbox
 */
export function writeShutdownResponse(
  projectDir: string,
  teamId: string,
  from: AgentRef,
  requestId: string,
  approved: boolean,
  reason?: string
): InboxMessage {
  return writeInbox(projectDir, teamId, {
    type: 'shutdown_response',
    from,
    to: createLeaderRef(),
    content: approved ? 'Shutdown approved' : `Shutdown declined: ${reason}`,
    summary: approved ? 'Shutdown approved' : 'Shutdown declined',
    status: 'pending',
    metadata: {
      requestId,
      approved,
      reason
    }
  });
}

// ============================================================================
// Message Display Helpers
// ============================================================================

/**
 * Format message for display
 */
export function formatMessageForDisplay(msg: InboxMessage): string {
  const toName = msg.to === 'all' ? 'all' : msg.to.name;
  const statusIcon = {
    'pending': '⏳',
    'delivered': '📬',
    'processed': '✅',
    'failed': '❌',
    'stale': '🕐'
  }[msg.status] || '?';

  const typeIcon = {
    'message': '💬',
    'broadcast': '📢',
    'approval_request': '🔔',
    'approval_response': '✓',
    'plan_approval_request': '📋',
    'plan_approval_response': '✅',
    'task_created': '📋',
    'task_claimed': '🏃',
    'task_completed': '🎉',
    'status_update': '📊',
    'shutdown_request': '🔴',
    'shutdown_response': '🟢'
  }[msg.type] || '📨';

  return `${statusIcon} ${typeIcon} [${msg.id}] ${msg.from.name} → ${toName}: ${msg.summary}`;
}
