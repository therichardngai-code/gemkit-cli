/**
 * Message Broker - Inter-agent communication via central inbox
 * All messages flow through the unified inbox system
 */

import { InboxMessage, GkTeam } from './types.js';
import { getTeam } from './manager.js';
import { generateUniqueId } from '../../services/hash.js';
import {
  writeMessage as writeInboxMessage,
  writeBroadcast as writeInboxBroadcast,
  writeShutdownRequest as writeInboxShutdownRequest,
  writeShutdownResponse as writeInboxShutdownResponse,
  createAgentRef,
  createLeaderRef
} from './inbox.js';

/**
 * Send a direct message to a specific agent
 * Writes to central inbox
 */
export async function sendMessage(
  projectDir: string,
  teamId: string,
  senderId: string,
  senderName: string,
  recipientId: string,
  recipientName: string,
  content: string,
  summary: string,
  options: {
    type?: 'message' | 'broadcast' | 'shutdown_request' | 'shutdown_response' | 'plan_approval_request' | 'plan_approval_response';
    requestId?: string;
    approve?: boolean;
  } = {}
): Promise<InboxMessage | null> {
  const fromRef = senderName === 'leader'
    ? createLeaderRef(senderId)
    : createAgentRef(senderId, senderName, 'member');

  const toRef = recipientName === 'leader'
    ? createLeaderRef(recipientId)
    : createAgentRef(recipientId, recipientName, 'member');

  const msgType = options.type || 'message';

  // Write to central inbox based on message type
  if (msgType === 'shutdown_request') {
    return writeInboxShutdownRequest(projectDir, teamId, toRef, content);
  } else if (msgType === 'shutdown_response') {
    return writeInboxShutdownResponse(
      projectDir,
      teamId,
      fromRef,
      options.requestId || '',
      options.approve || false,
      content
    );
  } else {
    // Regular message
    return writeInboxMessage(projectDir, teamId, fromRef, toRef, content, summary);
  }
}

/**
 * Broadcast a message to all team members (except sender)
 * Writes single broadcast entry to central inbox with to: 'all'
 */
export async function broadcast(
  projectDir: string,
  teamId: string,
  senderId: string,
  senderName: string,
  content: string,
  summary: string
): Promise<string[]> {
  const team = getTeam(projectDir, teamId);
  if (!team) {
    return [];
  }

  const fromRef = senderName === 'leader'
    ? createLeaderRef(senderId)
    : createAgentRef(senderId, senderName, 'member');

  // Write single broadcast to central inbox (with to: 'all')
  const inboxMsg = writeInboxBroadcast(projectDir, teamId, fromRef, content, summary);

  // Return the message ID (just one for the broadcast)
  return [inboxMsg.id];
}

/**
 * Send shutdown request to an agent
 */
export async function sendShutdownRequest(
  projectDir: string,
  teamId: string,
  senderId: string,
  senderName: string,
  recipientId: string,
  recipientName: string,
  reason: string = 'Task complete, wrapping up the session'
): Promise<{ message: InboxMessage; requestId: string } | null> {
  const requestId = generateUniqueId('shutdown');

  const message = await sendMessage(
    projectDir,
    teamId,
    senderId,
    senderName,
    recipientId,
    recipientName,
    reason,
    'Shutdown request',
    {
      type: 'shutdown_request',
      requestId
    }
  );

  if (message) {
    return { message, requestId };
  }

  return null;
}

/**
 * Respond to a shutdown request
 */
export async function respondToShutdown(
  projectDir: string,
  teamId: string,
  senderId: string,
  senderName: string,
  recipientId: string,
  recipientName: string,
  requestId: string,
  approve: boolean,
  reason?: string
): Promise<InboxMessage | null> {
  return sendMessage(
    projectDir,
    teamId,
    senderId,
    senderName,
    recipientId,
    recipientName,
    reason || (approve ? 'Shutdown approved' : 'Shutdown rejected'),
    approve ? 'Shutdown approved' : 'Shutdown rejected',
    {
      type: 'shutdown_response',
      requestId,
      approve
    }
  );
}

/**
 * Find agent by name in team
 */
export function findAgentByName(team: GkTeam, name: string): { agentId: string; name: string } | null {
  // Check if it's the leader
  if (name === 'leader' || name === team.teamName + '-leader') {
    return {
      agentId: team.leaderId,
      name: 'leader'
    };
  }

  // Find in members
  const member = team.members.find(m => m.name === name);
  if (member) {
    return {
      agentId: member.agentId,
      name: member.name
    };
  }

  return null;
}

/**
 * Find agent by ID in team
 */
export function findAgentById(team: GkTeam, agentId: string): { agentId: string; name: string } | null {
  const member = team.members.find(m => m.agentId === agentId);
  if (member) {
    return {
      agentId: member.agentId,
      name: member.name
    };
  }

  return null;
}
