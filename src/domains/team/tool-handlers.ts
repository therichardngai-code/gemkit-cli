/**
 * Tool Handlers - AI-invocable tools for team coordination
 * Maps tool calls to team operations
 */

import {
  GkTeam,
  TeamTask,
  InboxMessage,
  TeamOperationResult,
  TaskListResult
} from './types.js';
import {
  getTeam,
  getTeamForAgent,
  listTeams,
  getTask,
  getTaskList
} from './manager.js';
import {
  createTeam,
  updateTeamStatus,
  addMemberToTeam,
  updateMemberStatus,
  deleteTeam,
  deleteAllTeamData,
  createTask as writeTask,
  updateTask as writeUpdateTask
} from './writer.js';
import {
  sendMessage,
  broadcast,
  sendShutdownRequest,
  respondToShutdown,
  findAgentByName
} from './message-broker.js';
import { getPendingForAgent } from './inbox.js';
import {
  createTask,
  claimTask,
  completeTask,
  getAvailableTasks,
  getTaskSummary
} from './task-manager.js';
import { allocatePort, releasePort, releaseTeamPorts } from './port-manager.js';

// ============================================================================
// Team Tools
// ============================================================================

/**
 * TeamCreate - Create a new team with the current agent as leader
 */
export async function handleTeamCreate(
  projectDir: string,
  agentId: string,
  params: {
    team_name: string;
    description?: string;
  }
): Promise<TeamOperationResult<GkTeam>> {
  // Check if agent already leads a team
  const existingTeam = getTeamForAgent(projectDir, agentId);
  if (existingTeam && existingTeam.leaderId === agentId) {
    return {
      success: false,
      error: `Agent already leads team "${existingTeam.teamName}"`
    };
  }

  // Allocate port for leader
  const port = allocatePort(projectDir, agentId, 'pending', process.pid);
  if (!port) {
    return {
      success: false,
      error: 'No ports available for team leader'
    };
  }

  const team = createTeam({
    teamName: params.team_name,
    description: params.description,
    leaderId: agentId,
    leaderPort: port,
    projectDir
  });

  if (!team) {
    releasePort(projectDir, agentId);
    return {
      success: false,
      error: 'Failed to create team'
    };
  }

  return {
    success: true,
    data: team
  };
}

/**
 * TeamDelete - Delete team and clean up resources
 */
export async function handleTeamDelete(
  projectDir: string,
  agentId: string
): Promise<TeamOperationResult> {
  const team = getTeamForAgent(projectDir, agentId);
  if (!team) {
    return {
      success: false,
      error: 'No team found for this agent'
    };
  }

  // Only leader can delete team
  if (team.leaderId !== agentId) {
    return {
      success: false,
      error: 'Only team leader can delete the team'
    };
  }

  // Check for active members
  const activeMembers = team.members.filter(
    m => m.status !== 'shutdown' && m.agentId !== agentId
  );
  if (activeMembers.length > 0) {
    return {
      success: false,
      error: `Cannot delete team: ${activeMembers.length} active members. Send shutdown requests first.`
    };
  }

  // Release all team ports
  releaseTeamPorts(projectDir, team.teamId);

  // Delete team
  if (!deleteTeam(projectDir, team.teamId)) {
    return {
      success: false,
      error: 'Failed to delete team'
    };
  }

  return { success: true };
}

// ============================================================================
// Task Tools
// ============================================================================

/**
 * TaskCreate - Create a new task
 */
export async function handleTaskCreate(
  projectDir: string,
  agentId: string,
  agentName: string,
  params: {
    subject: string;
    description: string;
    activeForm?: string;
    blockedBy?: string[];
    metadata?: Record<string, unknown>;
  }
): Promise<TeamOperationResult<TeamTask>> {
  const team = getTeamForAgent(projectDir, agentId);
  if (!team) {
    return {
      success: false,
      error: 'Agent is not part of any team'
    };
  }

  const task = createTask(
    projectDir,
    team.teamId,
    params.subject,
    params.description,
    agentName,
    {
      activeForm: params.activeForm,
      blockedBy: params.blockedBy,
      metadata: params.metadata
    }
  );

  if (!task) {
    return {
      success: false,
      error: 'Failed to create task'
    };
  }

  return {
    success: true,
    data: task
  };
}

/**
 * TaskUpdate - Update task status, owner, or dependencies
 */
export async function handleTaskUpdate(
  projectDir: string,
  agentId: string,
  agentName: string,
  params: {
    taskId: string;
    status?: 'pending' | 'in_progress' | 'completed' | 'deleted';
    subject?: string;
    description?: string;
    activeForm?: string;
    owner?: string | null;
    addBlocks?: string[];
    addBlockedBy?: string[];
    metadata?: Record<string, unknown>;
  }
): Promise<TeamOperationResult<TeamTask>> {
  const task = getTask(projectDir, params.taskId);
  if (!task) {
    return {
      success: false,
      error: `Task ${params.taskId} not found`
    };
  }

  // If claiming task (setting owner), use claimTask for validation
  if (params.owner && params.status === 'in_progress') {
    const claimed = claimTask(projectDir, params.taskId, params.owner);
    if (!claimed) {
      return {
        success: false,
        error: 'Failed to claim task (may be blocked or already claimed)'
      };
    }
    return { success: true, data: claimed };
  }

  // If completing task, use completeTask for cascade
  if (params.status === 'completed') {
    const result = await completeTask(projectDir, params.taskId);
    if (!result) {
      return {
        success: false,
        error: 'Failed to complete task'
      };
    }
    return { success: true, data: result.task };
  }

  // General update
  const updated = writeUpdateTask(projectDir, params.taskId, {
    status: params.status,
    subject: params.subject,
    description: params.description,
    activeForm: params.activeForm,
    owner: params.owner,
    addBlocks: params.addBlocks,
    addBlockedBy: params.addBlockedBy,
    metadata: params.metadata
  });

  if (!updated) {
    return {
      success: false,
      error: 'Failed to update task'
    };
  }

  return { success: true, data: updated };
}

/**
 * TaskGet - Get task details
 */
export async function handleTaskGet(
  projectDir: string,
  params: { taskId: string }
): Promise<TeamOperationResult<TeamTask>> {
  const task = getTask(projectDir, params.taskId);
  if (!task) {
    return {
      success: false,
      error: `Task ${params.taskId} not found`
    };
  }

  return { success: true, data: task };
}

/**
 * TaskList - List all tasks with categorization
 */
export async function handleTaskList(
  projectDir: string,
  agentId: string
): Promise<TeamOperationResult<TaskListResult & { summary: ReturnType<typeof getTaskSummary> }>> {
  const team = getTeamForAgent(projectDir, agentId);
  if (!team) {
    return {
      success: false,
      error: 'Agent is not part of any team'
    };
  }

  const taskList = getTaskList(projectDir, team.teamId);
  const summary = getTaskSummary(projectDir, team.teamId);

  return {
    success: true,
    data: {
      ...taskList,
      summary
    }
  };
}

// ============================================================================
// Message Tools
// ============================================================================

/**
 * SendMessage - Send message to teammate(s)
 */
export async function handleSendMessage(
  projectDir: string,
  agentId: string,
  agentName: string,
  params: {
    type: 'message' | 'broadcast' | 'shutdown_request' | 'shutdown_response' | 'plan_approval_response';
    recipient?: string;
    content?: string;
    summary?: string;
    request_id?: string;
    approve?: boolean;
  }
): Promise<TeamOperationResult<InboxMessage | string[]>> {
  const team = getTeamForAgent(projectDir, agentId);
  if (!team) {
    return {
      success: false,
      error: 'Agent is not part of any team'
    };
  }

  // Handle broadcast
  if (params.type === 'broadcast') {
    if (!params.content || !params.summary) {
      return {
        success: false,
        error: 'Broadcast requires content and summary'
      };
    }

    const messageIds = await broadcast(
      projectDir,
      team.teamId,
      agentId,
      agentName,
      params.content,
      params.summary
    );

    return {
      success: true,
      data: messageIds
    };
  }

  // All other types require recipient
  if (!params.recipient) {
    return {
      success: false,
      error: 'Message requires recipient'
    };
  }

  // Find recipient
  const recipient = findAgentByName(team, params.recipient);
  if (!recipient) {
    return {
      success: false,
      error: `Recipient "${params.recipient}" not found in team`
    };
  }

  // Handle shutdown request
  if (params.type === 'shutdown_request') {
    const result = await sendShutdownRequest(
      projectDir,
      team.teamId,
      agentId,
      agentName,
      recipient.agentId,
      recipient.name,
      params.content
    );

    if (!result) {
      return {
        success: false,
        error: 'Failed to send shutdown request'
      };
    }

    return { success: true, data: result.message };
  }

  // Handle shutdown response
  if (params.type === 'shutdown_response') {
    if (!params.request_id || params.approve === undefined) {
      return {
        success: false,
        error: 'Shutdown response requires request_id and approve'
      };
    }

    const message = await respondToShutdown(
      projectDir,
      team.teamId,
      agentId,
      agentName,
      recipient.agentId,
      recipient.name,
      params.request_id,
      params.approve,
      params.content
    );

    if (!message) {
      return {
        success: false,
        error: 'Failed to send shutdown response'
      };
    }

    return { success: true, data: message };
  }

  // Handle plan approval response
  if (params.type === 'plan_approval_response') {
    if (!params.request_id || params.approve === undefined) {
      return {
        success: false,
        error: 'Plan approval response requires request_id and approve'
      };
    }

    const message = await sendMessage(
      projectDir,
      team.teamId,
      agentId,
      agentName,
      recipient.agentId,
      recipient.name,
      params.content || (params.approve ? 'Plan approved' : 'Plan rejected'),
      params.approve ? 'Plan approved' : 'Plan needs revision',
      {
        type: 'plan_approval_response',
        requestId: params.request_id,
        approve: params.approve
      }
    );

    if (!message) {
      return {
        success: false,
        error: 'Failed to send plan approval response'
      };
    }

    return { success: true, data: message };
  }

  // Regular message
  if (!params.content || !params.summary) {
    return {
      success: false,
      error: 'Message requires content and summary'
    };
  }

  const message = await sendMessage(
    projectDir,
    team.teamId,
    agentId,
    agentName,
    recipient.agentId,
    recipient.name,
    params.content,
    params.summary
  );

  if (!message) {
    return {
      success: false,
      error: 'Failed to send message'
    };
  }

  return { success: true, data: message };
}

/**
 * CheckInbox - Get pending messages for the agent
 */
export async function handleCheckInbox(
  projectDir: string,
  agentId: string,
  teamId: string,
  agentName: string
): Promise<TeamOperationResult<{ messages: InboxMessage[]; count: number }>> {
  const messages = getPendingForAgent(projectDir, teamId, agentName);

  return {
    success: true,
    data: {
      messages,
      count: messages.length
    }
  };
}

// ============================================================================
// Member Management Tools
// ============================================================================

/**
 * Add a new member to the team (used when spawning sub-agents)
 */
export async function handleAddMember(
  projectDir: string,
  leaderId: string,
  params: {
    agentId: string;
    name: string;
    agentType: string;
    pid?: number;
  }
): Promise<TeamOperationResult> {
  const team = getTeamForAgent(projectDir, leaderId);
  if (!team) {
    return {
      success: false,
      error: 'Leader is not part of any team'
    };
  }

  if (team.leaderId !== leaderId) {
    return {
      success: false,
      error: 'Only team leader can add members'
    };
  }

  // Allocate port for new member
  const port = allocatePort(projectDir, params.agentId, team.teamId, params.pid || null);
  if (!port) {
    return {
      success: false,
      error: 'No ports available for new member'
    };
  }

  const success = addMemberToTeam(projectDir, team.teamId, {
    agentId: params.agentId,
    name: params.name,
    agentType: params.agentType,
    role: 'member',
    port,
    pid: params.pid || null,
    status: 'starting'
  });

  if (!success) {
    releasePort(projectDir, params.agentId);
    return {
      success: false,
      error: 'Failed to add member to team'
    };
  }

  return { success: true };
}

/**
 * Update member status
 */
export async function handleUpdateMemberStatus(
  projectDir: string,
  agentId: string,
  status: 'starting' | 'ready' | 'busy' | 'idle' | 'shutdown'
): Promise<TeamOperationResult> {
  const team = getTeamForAgent(projectDir, agentId);
  if (!team) {
    return {
      success: false,
      error: 'Agent is not part of any team'
    };
  }

  const success = updateMemberStatus(projectDir, team.teamId, agentId, status);
  if (!success) {
    return {
      success: false,
      error: 'Failed to update member status'
    };
  }

  // If shutting down, release port
  if (status === 'shutdown') {
    releasePort(projectDir, agentId);
  }

  return { success: true };
}

// ============================================================================
// Info Tools
// ============================================================================

/**
 * Get team info for current agent
 */
export async function handleGetTeamInfo(
  projectDir: string,
  agentId: string
): Promise<TeamOperationResult<GkTeam>> {
  const team = getTeamForAgent(projectDir, agentId);
  if (!team) {
    return {
      success: false,
      error: 'Agent is not part of any team'
    };
  }

  return { success: true, data: team };
}

/**
 * List all teams in project
 */
export async function handleListTeams(
  projectDir: string
): Promise<TeamOperationResult<GkTeam[]>> {
  const teams = listTeams(projectDir);
  return { success: true, data: teams };
}
