/**
 * Team domain - Multi-agent coordination
 * Export all team-related functionality
 */

// Types
export * from './types.js';

// Storage utilities
export {
  GEMKIT_HOME,
  TEAMS_BASE_DIR,
  getTeamsDir,
  getTeamPath,
  getPortsPath,
  getTasksDir,
  getTaskPath,
  getTasksIndexPath,
  getInboxPath,
  ensureDir,
  atomicWrite,
  readJson,
  deleteFile,
  listFiles,
  deleteDir,
  initTeamStorage
} from './storage.js';

// Central Inbox
export {
  writeInbox,
  readInbox,
  getInboxMessage,
  updateInboxMessage,
  getPendingForAgent,
  getPendingApprovals,
  getAllPending,
  createAgentRef,
  createLeaderRef,
  writeMessage,
  writeBroadcast,
  writeApprovalRequest,
  writeApprovalResponse,
  writeTaskCreated,
  writeTaskClaimed,
  writeTaskCompleted,
  writeStatusUpdate,
  writeShutdownRequest,
  writeShutdownResponse,
  formatMessageForDisplay
} from './inbox.js';

// Inbox Hooks
export {
  processMessageHook,
  validateApprovalRequest,
  validateAndApprove
} from './hooks.js';

// Port management
export {
  getPortRegistry,
  allocatePort,
  releasePort,
  releaseTeamPorts,
  updatePortPid,
  getAgentPort,
  getTeamPorts,
  cleanupStalePorts,
  getPortStats
} from './port-manager.js';

// Read operations (manager)
export {
  getTeam,
  getTeamForAgent,
  listTeams,
  getActiveTeams,
  getTeamMember,
  getTeamMemberById,
  getTask,
  listAllTasks,
  listTeamTasks,
  getTaskList,
  isTaskBlocked,
  getUnblockedByCompletion
} from './manager.js';

// Write operations
export {
  createTeam,
  updateTeamStatus,
  addMemberToTeam,
  updateMemberStatus,
  updateMemberPid,
  removeMember,
  deleteTeam,
  deleteAllTeamData,
  createTask as createTaskRaw,
  updateTask as updateTaskRaw,
  deleteTask as deleteTaskRaw
} from './writer.js';

// Message broker
export {
  sendMessage,
  broadcast,
  sendShutdownRequest,
  respondToShutdown,
  findAgentByName,
  findAgentById
} from './message-broker.js';

// Task manager (higher-level operations)
export {
  createTask,
  updateTaskStatus,
  claimTask,
  releaseTask,
  completeTask,
  getNextAvailableTask,
  getAvailableTasks,
  getAgentTasks,
  getInProgressTasks,
  getBlockedTasksWithDetails,
  addDependency,
  getTaskSummary,
  areAllTasksCompleted,
  deleteTask
} from './task-manager.js';

// Tool handlers (for AI integration)
export {
  handleTeamCreate,
  handleTeamDelete,
  handleTaskCreate,
  handleTaskUpdate,
  handleTaskGet,
  handleTaskList,
  handleSendMessage,
  handleCheckInbox,
  handleAddMember,
  handleUpdateMemberStatus,
  handleGetTeamInfo,
  handleListTeams
} from './tool-handlers.js';

// Team member spawning
export {
  spawnTeamMember,
  spawnBestAgentForTask,
  type SpawnMemberOptions,
  type SpawnMemberResult
} from './spawn-member.js';

// Shutdown management
export {
  requestMemberShutdown,
  requestTeamShutdown,
  waitForShutdowns,
  cleanupOrphanedMembers,
  emergencyTeamShutdown,
  getPendingShutdownCount,
  getPendingShutdowns,
  cancelShutdownRequest
} from './shutdown-manager.js';
