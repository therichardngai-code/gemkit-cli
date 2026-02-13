/**
 * Team Writer - WRITE operations for team data
 * Following patterns from src/domains/session/writer.ts
 */

import {
  GkTeam,
  TeamMember,
  TeamTask,
  TeamCreateInput,
  TaskCreateInput,
  TaskUpdateInput,
  MemberAddInput,
  TeamStatus,
  MemberStatus
} from './types.js';
import {
  getTeamPath,
  getTaskPath,
  atomicWrite,
  readJson,
  deleteFile,
  initTeamStorage,
  ensureDir,
  getTeamsDir,
  deleteDir
} from './storage.js';
import { getTeam, getTask } from './manager.js';
import { generateUniqueId } from '../../services/hash.js';

// ============================================================================
// Team operations
// ============================================================================

/**
 * Create a new team
 */
export function createTeam(input: TeamCreateInput): GkTeam | null {
  const teamId = generateUniqueId('team');

  // Initialize storage structure
  initTeamStorage(input.projectDir);

  const now = new Date().toISOString();

  const team: GkTeam = {
    teamId,
    teamName: input.teamName,
    description: input.description || '',
    projectDir: input.projectDir,
    leaderId: input.leaderId,
    leaderPort: input.leaderPort,
    members: [{
      agentId: input.leaderId,
      name: 'leader',
      agentType: 'leader',
      role: 'leader',
      port: input.leaderPort,
      pid: process.pid,
      status: 'ready',
      joinedAt: now,
      lastActiveAt: now
    }],
    status: 'active',
    createdAt: now,
    updatedAt: now
  };

  if (atomicWrite(getTeamPath(input.projectDir, teamId), team)) {
    return team;
  }

  return null;
}

/**
 * Update team status
 */
export function updateTeamStatus(projectDir: string, teamId: string, status: TeamStatus): boolean {
  const team = getTeam(projectDir, teamId);
  if (!team) return false;

  team.status = status;
  team.updatedAt = new Date().toISOString();

  return atomicWrite(getTeamPath(projectDir, teamId), team);
}

/**
 * Add a member to a team
 */
export function addTeamMember(input: MemberAddInput): boolean {
  const team = getTeam(input.teamId.split('-')[0] === 'team'
    ? '' // Will be resolved
    : '', input.teamId);

  // We need projectDir - get it from looking up the team
  // Actually, let's change the interface to include projectDir
  return false; // Placeholder - will be fixed
}

/**
 * Add member to team (with projectDir)
 */
export function addMemberToTeam(
  projectDir: string,
  teamId: string,
  member: Omit<TeamMember, 'joinedAt' | 'lastActiveAt'>
): boolean {
  const team = getTeam(projectDir, teamId);
  if (!team) return false;

  // Check if member already exists
  const existingIndex = team.members.findIndex(m => m.agentId === member.agentId);

  const now = new Date().toISOString();
  const fullMember: TeamMember = {
    ...member,
    joinedAt: now,
    lastActiveAt: now
  };

  if (existingIndex >= 0) {
    team.members[existingIndex] = fullMember;
  } else {
    team.members.push(fullMember);
  }

  team.updatedAt = now;

  if (atomicWrite(getTeamPath(projectDir, teamId), team)) {
    return true;
  }

  return false;
}

/**
 * Update member status
 */
export function updateMemberStatus(
  projectDir: string,
  teamId: string,
  agentId: string,
  status: MemberStatus
): boolean {
  const team = getTeam(projectDir, teamId);
  if (!team) return false;

  const member = team.members.find(m => m.agentId === agentId);
  if (!member) return false;

  member.status = status;
  member.lastActiveAt = new Date().toISOString();
  team.updatedAt = new Date().toISOString();

  return atomicWrite(getTeamPath(projectDir, teamId), team);
}

/**
 * Update member PID
 */
export function updateMemberPid(
  projectDir: string,
  teamId: string,
  agentId: string,
  pid: number
): boolean {
  const team = getTeam(projectDir, teamId);
  if (!team) return false;

  const member = team.members.find(m => m.agentId === agentId);
  if (!member) return false;

  member.pid = pid;
  member.lastActiveAt = new Date().toISOString();
  team.updatedAt = new Date().toISOString();

  return atomicWrite(getTeamPath(projectDir, teamId), team);
}

/**
 * Remove member from team
 */
export function removeMember(projectDir: string, teamId: string, agentId: string): boolean {
  const team = getTeam(projectDir, teamId);
  if (!team) return false;

  team.members = team.members.filter(m => m.agentId !== agentId);
  team.updatedAt = new Date().toISOString();

  return atomicWrite(getTeamPath(projectDir, teamId), team);
}

/**
 * Delete a team and all its data
 */
export function deleteTeam(projectDir: string, teamId: string): boolean {
  // Delete team file
  const teamDeleted = deleteFile(getTeamPath(projectDir, teamId));

  // Note: Tasks and messages are shared at project level
  // They are not deleted when a team is deleted (for audit trail)

  return teamDeleted;
}

/**
 * Delete all team data for a project (full cleanup)
 */
export function deleteAllTeamData(projectDir: string): boolean {
  return deleteDir(getTeamsDir(projectDir));
}

// ============================================================================
// Task operations
// ============================================================================

/**
 * Create a new task
 */
export function createTask(projectDir: string, input: TaskCreateInput): TeamTask | null {
  const taskId = generateUniqueId('task');

  const now = new Date().toISOString();

  const task: TeamTask = {
    taskId,
    teamId: input.teamId,
    subject: input.subject,
    description: input.description,
    activeForm: input.activeForm || `Working on: ${input.subject}`,
    status: 'pending',
    owner: null,
    createdBy: input.createdBy,
    blockedBy: input.blockedBy || [],
    blocks: [],
    metadata: input.metadata || {},
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };

  // Update reverse dependencies (blocks array on blocking tasks)
  for (const blockerId of task.blockedBy) {
    const blocker = getTask(projectDir, blockerId);
    if (blocker && !blocker.blocks.includes(taskId)) {
      blocker.blocks.push(taskId);
      atomicWrite(getTaskPath(projectDir, blockerId), blocker);
    }
  }

  if (atomicWrite(getTaskPath(projectDir, taskId), task)) {
    return task;
  }

  return null;
}

/**
 * Update a task
 */
export function updateTask(
  projectDir: string,
  taskId: string,
  updates: TaskUpdateInput
): TeamTask | null {
  const task = getTask(projectDir, taskId);
  if (!task) return null;

  const now = new Date().toISOString();

  // Apply updates
  if (updates.status !== undefined) {
    task.status = updates.status;
    if (updates.status === 'completed') {
      task.completedAt = now;
    }
  }
  if (updates.subject !== undefined) task.subject = updates.subject;
  if (updates.description !== undefined) task.description = updates.description;
  if (updates.activeForm !== undefined) task.activeForm = updates.activeForm;
  if (updates.owner !== undefined) task.owner = updates.owner;
  if (updates.metadata !== undefined) {
    task.metadata = { ...task.metadata, ...updates.metadata };
  }

  // Handle dependency additions
  if (updates.addBlockedBy) {
    for (const blockerId of updates.addBlockedBy) {
      if (!task.blockedBy.includes(blockerId)) {
        task.blockedBy.push(blockerId);

        // Update reverse dependency
        const blocker = getTask(projectDir, blockerId);
        if (blocker && !blocker.blocks.includes(taskId)) {
          blocker.blocks.push(taskId);
          atomicWrite(getTaskPath(projectDir, blockerId), blocker);
        }
      }
    }
  }

  if (updates.addBlocks) {
    for (const blockedId of updates.addBlocks) {
      if (!task.blocks.includes(blockedId)) {
        task.blocks.push(blockedId);

        // Update reverse dependency
        const blocked = getTask(projectDir, blockedId);
        if (blocked && !blocked.blockedBy.includes(taskId)) {
          blocked.blockedBy.push(taskId);
          atomicWrite(getTaskPath(projectDir, blockedId), blocked);
        }
      }
    }
  }

  // Handle dependency removals
  if (updates.removeBlockedBy) {
    for (const blockerId of updates.removeBlockedBy) {
      const idx = task.blockedBy.indexOf(blockerId);
      if (idx !== -1) {
        task.blockedBy.splice(idx, 1);

        // Update reverse dependency
        const blocker = getTask(projectDir, blockerId);
        if (blocker) {
          const blocksIdx = blocker.blocks.indexOf(taskId);
          if (blocksIdx !== -1) {
            blocker.blocks.splice(blocksIdx, 1);
            atomicWrite(getTaskPath(projectDir, blockerId), blocker);
          }
        }
      }
    }
  }

  if (updates.removeBlocks) {
    for (const blockedId of updates.removeBlocks) {
      const idx = task.blocks.indexOf(blockedId);
      if (idx !== -1) {
        task.blocks.splice(idx, 1);

        // Update reverse dependency
        const blocked = getTask(projectDir, blockedId);
        if (blocked) {
          const blockedByIdx = blocked.blockedBy.indexOf(taskId);
          if (blockedByIdx !== -1) {
            blocked.blockedBy.splice(blockedByIdx, 1);
            atomicWrite(getTaskPath(projectDir, blockedId), blocked);
          }
        }
      }
    }
  }

  task.updatedAt = now;

  if (atomicWrite(getTaskPath(projectDir, taskId), task)) {
    return task;
  }

  return null;
}

/**
 * Delete a task (marks as deleted, doesn't remove file)
 */
export function deleteTask(projectDir: string, taskId: string): boolean {
  return updateTask(projectDir, taskId, { status: 'deleted' }) !== null;
}
