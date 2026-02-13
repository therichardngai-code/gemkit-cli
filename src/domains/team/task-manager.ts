/**
 * Task Manager - Higher-level task operations with dependency handling
 * Builds on writer.ts for atomic operations
 * Writes task events to central inbox for audit trail
 */

import {
  TeamTask,
  TaskCreateInput,
  TaskUpdateInput,
  TaskListResult
} from './types.js';
import {
  getTask,
  listTeamTasks,
  getTaskList,
  isTaskBlocked,
  getUnblockedByCompletion
} from './manager.js';
import {
  createTask as writeTask,
  updateTask as writeUpdateTask,
  deleteTask as writeDeleteTask
} from './writer.js';
import {
  writeTaskCreated,
  writeTaskClaimed,
  writeTaskCompleted,
  createAgentRef,
  createLeaderRef
} from './inbox.js';
import { processMessageHook } from './hooks.js';

/**
 * Create a task with validation
 * Also writes task_created to central inbox
 */
export function createTask(
  projectDir: string,
  teamId: string,
  subject: string,
  description: string,
  createdBy: string,
  options: {
    activeForm?: string;
    blockedBy?: string[];
    metadata?: Record<string, unknown>;
  } = {}
): TeamTask | null {
  // Validate blockedBy references exist
  if (options.blockedBy) {
    for (const blockerId of options.blockedBy) {
      const blocker = getTask(projectDir, blockerId);
      if (!blocker) {
        console.error(`Task ${blockerId} does not exist, cannot add as blocker`);
        return null;
      }
    }
  }

  const input: TaskCreateInput = {
    teamId,
    subject,
    description,
    activeForm: options.activeForm,
    createdBy,
    blockedBy: options.blockedBy,
    metadata: options.metadata
  };

  const task = writeTask(projectDir, input);

  // Write to central inbox
  if (task) {
    const fromRef = createdBy === 'leader'
      ? createLeaderRef()
      : createAgentRef(createdBy, createdBy, 'member');

    writeTaskCreated(
      projectDir,
      teamId,
      fromRef,
      task.taskId,
      subject,
      options.blockedBy
    );
  }

  return task;
}

/**
 * Update task status with dependency cascade
 * When a task is completed, updates dependent tasks' blocked status
 */
export function updateTaskStatus(
  projectDir: string,
  taskId: string,
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
): { task: TeamTask; unblocked: TeamTask[] } | null {
  const task = writeUpdateTask(projectDir, taskId, { status });
  if (!task) {
    return null;
  }

  const unblocked: TeamTask[] = [];

  // If completed, check what tasks are now unblocked
  if (status === 'completed') {
    const nowUnblocked = getUnblockedByCompletion(projectDir, taskId);
    unblocked.push(...nowUnblocked);
  }

  return { task, unblocked };
}

/**
 * Claim a task (set owner and mark in_progress)
 * Also writes task_claimed to central inbox
 */
export function claimTask(
  projectDir: string,
  taskId: string,
  ownerName: string
): TeamTask | null {
  const task = getTask(projectDir, taskId);
  if (!task) {
    return null;
  }

  // Check if already claimed
  if (task.owner && task.owner !== ownerName) {
    console.error(`Task ${taskId} already claimed by ${task.owner}`);
    return null;
  }

  // Check if blocked
  if (isTaskBlocked(projectDir, taskId)) {
    console.error(`Task ${taskId} is blocked by unfinished dependencies`);
    return null;
  }

  const updatedTask = writeUpdateTask(projectDir, taskId, {
    owner: ownerName,
    status: 'in_progress'
  });

  // Write to central inbox
  if (updatedTask) {
    const fromRef = createAgentRef(ownerName, ownerName, 'member');

    writeTaskClaimed(
      projectDir,
      task.teamId,
      fromRef,
      taskId,
      task.subject
    );
  }

  return updatedTask;
}

/**
 * Release a task (remove owner, set back to pending)
 */
export function releaseTask(
  projectDir: string,
  taskId: string
): TeamTask | null {
  return writeUpdateTask(projectDir, taskId, {
    owner: null,
    status: 'pending'
  });
}

/**
 * Complete a task and return newly unblocked tasks
 * Also writes task_completed to central inbox and triggers unblock hook
 */
export async function completeTask(
  projectDir: string,
  taskId: string
): Promise<{ task: TeamTask; unblocked: TeamTask[] } | null> {
  const task = getTask(projectDir, taskId);
  if (!task) {
    return null;
  }

  const result = updateTaskStatus(projectDir, taskId, 'completed');
  if (!result) {
    return null;
  }

  // Write to central inbox
  const ownerName = task.owner || 'unknown';
  const fromRef = createAgentRef(ownerName, ownerName, 'member');

  const inboxMessage = writeTaskCompleted(
    projectDir,
    task.teamId,
    fromRef,
    taskId,
    task.subject
  );

  // Process hook to unblock dependent tasks
  await processMessageHook(projectDir, task.teamId, inboxMessage);

  return result;
}

/**
 * Get next available task for an agent
 * Prefers lower task IDs (created earlier)
 */
export function getNextAvailableTask(
  projectDir: string,
  teamId: string
): TeamTask | null {
  const taskList = getTaskList(projectDir, teamId);
  return taskList.available[0] || null;
}

/**
 * Get all available tasks for claiming
 */
export function getAvailableTasks(
  projectDir: string,
  teamId: string
): TeamTask[] {
  const taskList = getTaskList(projectDir, teamId);
  return taskList.available;
}

/**
 * Get tasks owned by a specific agent
 */
export function getAgentTasks(
  projectDir: string,
  teamId: string,
  ownerName: string
): TeamTask[] {
  const tasks = listTeamTasks(projectDir, teamId);
  return tasks.filter(t => t.owner === ownerName && t.status !== 'deleted');
}

/**
 * Get tasks in progress for a team
 */
export function getInProgressTasks(
  projectDir: string,
  teamId: string
): TeamTask[] {
  const taskList = getTaskList(projectDir, teamId);
  return taskList.inProgress;
}

/**
 * Get blocked tasks with their blockers
 */
export function getBlockedTasksWithDetails(
  projectDir: string,
  teamId: string
): Array<{ task: TeamTask; blockers: TeamTask[] }> {
  const taskList = getTaskList(projectDir, teamId);

  return taskList.blocked.map(task => ({
    task,
    blockers: task.blockedBy
      .map(id => getTask(projectDir, id))
      .filter((t): t is TeamTask => t !== null && t.status !== 'completed')
  }));
}

/**
 * Add dependency between tasks
 */
export function addDependency(
  projectDir: string,
  taskId: string,
  blockedByTaskId: string
): boolean {
  const task = writeUpdateTask(projectDir, taskId, {
    addBlockedBy: [blockedByTaskId]
  });
  return task !== null;
}

/**
 * Get task summary for display
 */
export function getTaskSummary(
  projectDir: string,
  teamId: string
): {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  blocked: number;
  available: number;
} {
  const taskList = getTaskList(projectDir, teamId);

  return {
    total: taskList.tasks.length,
    pending: taskList.tasks.filter(t => t.status === 'pending').length,
    inProgress: taskList.inProgress.length,
    completed: taskList.completed.length,
    blocked: taskList.blocked.length,
    available: taskList.available.length
  };
}

/**
 * Check if all tasks are completed
 */
export function areAllTasksCompleted(projectDir: string, teamId: string): boolean {
  const tasks = listTeamTasks(projectDir, teamId);
  const activeTasks = tasks.filter(t => t.status !== 'deleted');

  if (activeTasks.length === 0) {
    return true;
  }

  return activeTasks.every(t => t.status === 'completed');
}

/**
 * Delete task with validation
 */
export function deleteTask(projectDir: string, taskId: string): boolean {
  const task = getTask(projectDir, taskId);
  if (!task) {
    return false;
  }

  // Check if other tasks depend on this one
  if (task.blocks.length > 0) {
    const blockingActive = task.blocks.some(id => {
      const blocked = getTask(projectDir, id);
      return blocked && blocked.status !== 'deleted' && blocked.status !== 'completed';
    });

    if (blockingActive) {
      console.error(`Cannot delete task ${taskId}: other tasks depend on it`);
      return false;
    }
  }

  return writeDeleteTask(projectDir, taskId);
}
