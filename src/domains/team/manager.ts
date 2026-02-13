/**
 * Team Manager - READ operations for team data
 * Following patterns from src/domains/session/manager.ts
 */

import {
  GkTeam,
  TeamMember,
  TeamTask,
  TaskListResult,
  TaskStatus
} from './types.js';
import {
  getTeamPath,
  getTaskPath,
  getTasksDir,
  readJson,
  listFiles,
  getTeamsDir
} from './storage.js';

// ============================================================================
// Team operations
// ============================================================================

/**
 * Get team by ID
 */
export function getTeam(projectDir: string, teamId: string): GkTeam | null {
  return readJson<GkTeam>(getTeamPath(projectDir, teamId));
}

/**
 * Get team for an agent (by agent ID)
 */
export function getTeamForAgent(projectDir: string, agentId: string): GkTeam | null {
  const teams = listTeams(projectDir);

  for (const team of teams) {
    if (team.leaderId === agentId) {
      return team;
    }
    if (team.members.some(m => m.agentId === agentId)) {
      return team;
    }
  }

  return null;
}

/**
 * List all teams for a project
 */
export function listTeams(projectDir: string): GkTeam[] {
  const teamsDir = getTeamsDir(projectDir);
  const teamFiles = listFiles(teamsDir, 'team-', '.json');

  const teams: GkTeam[] = [];
  for (const file of teamFiles) {
    const teamId = file.replace('team-', '').replace('.json', '');
    const team = getTeam(projectDir, teamId);
    if (team) {
      teams.push(team);
    }
  }

  return teams;
}

/**
 * Get active teams (status = 'active')
 */
export function getActiveTeams(projectDir: string): GkTeam[] {
  return listTeams(projectDir).filter(t => t.status === 'active');
}

/**
 * Get team member by name
 */
export function getTeamMember(projectDir: string, teamId: string, memberName: string): TeamMember | null {
  const team = getTeam(projectDir, teamId);
  if (!team) return null;

  return team.members.find(m => m.name === memberName) || null;
}

/**
 * Get team member by agent ID
 */
export function getTeamMemberById(projectDir: string, teamId: string, agentId: string): TeamMember | null {
  const team = getTeam(projectDir, teamId);
  if (!team) return null;

  return team.members.find(m => m.agentId === agentId) || null;
}

// ============================================================================
// Task operations
// ============================================================================

/**
 * Get task by ID
 */
export function getTask(projectDir: string, taskId: string): TeamTask | null {
  return readJson<TeamTask>(getTaskPath(projectDir, taskId));
}

/**
 * List all tasks for the project
 */
export function listAllTasks(projectDir: string): TeamTask[] {
  const tasksDir = getTasksDir(projectDir);
  const taskFiles = listFiles(tasksDir, 'task-', '.json');

  const tasks: TeamTask[] = [];
  for (const file of taskFiles) {
    const taskId = file.replace('task-', '').replace('.json', '');
    const task = getTask(projectDir, taskId);
    if (task) {
      tasks.push(task);
    }
  }

  // Sort by creation date (oldest first for processing order)
  return tasks.sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/**
 * List tasks for a specific team
 */
export function listTeamTasks(projectDir: string, teamId: string): TeamTask[] {
  return listAllTasks(projectDir).filter(t => t.teamId === teamId);
}

/**
 * Get categorized task list with availability info
 */
export function getTaskList(projectDir: string, teamId: string): TaskListResult {
  const allTasks = listTeamTasks(projectDir, teamId);

  // Filter out deleted tasks
  const tasks = allTasks.filter(t => t.status !== 'deleted');

  // Categorize tasks
  const completed = tasks.filter(t => t.status === 'completed');
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  const pending = tasks.filter(t => t.status === 'pending');

  // Find blocked tasks (have unresolved dependencies)
  const completedIds = new Set(completed.map(t => t.taskId));
  const blocked = pending.filter(t =>
    t.blockedBy.length > 0 &&
    t.blockedBy.some(depId => !completedIds.has(depId))
  );
  const blockedIds = new Set(blocked.map(t => t.taskId));

  // Available = pending, not blocked, no owner
  const available = pending.filter(t =>
    !blockedIds.has(t.taskId) &&
    !t.owner
  );

  return {
    tasks,
    available,
    blocked,
    inProgress,
    completed
  };
}

/**
 * Check if a task is blocked
 */
export function isTaskBlocked(projectDir: string, taskId: string): boolean {
  const task = getTask(projectDir, taskId);
  if (!task || task.blockedBy.length === 0) {
    return false;
  }

  // Check if all dependencies are completed
  for (const depId of task.blockedBy) {
    const dep = getTask(projectDir, depId);
    if (!dep || dep.status !== 'completed') {
      return true;
    }
  }

  return false;
}

/**
 * Get tasks that would be unblocked if a task completes
 */
export function getUnblockedByCompletion(projectDir: string, taskId: string): TeamTask[] {
  const allTasks = listAllTasks(projectDir);

  return allTasks.filter(task => {
    if (task.status !== 'pending') return false;
    if (!task.blockedBy.includes(taskId)) return false;

    // Check if this is the last blocking task
    const otherBlockers = task.blockedBy.filter(id => id !== taskId);
    for (const blockerId of otherBlockers) {
      const blocker = getTask(projectDir, blockerId);
      if (!blocker || blocker.status !== 'completed') {
        return false; // Still blocked by another task
      }
    }
    return true;
  });
}

