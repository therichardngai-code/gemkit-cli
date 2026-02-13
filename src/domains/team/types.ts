/**
 * Team type definitions for multi-agent coordination
 * Enables Main Agent (Orchestrator) to spawn and coordinate sub-agents
 */

/**
 * GkTeam - Team configuration with leader and members
 */
export interface GkTeam {
  teamId: string;
  teamName: string;
  description: string;
  projectDir: string;
  leaderId: string;              // Main agent's gkSessionId
  leaderPort: number;            // Leader's PTY server port
  members: TeamMember[];
  status: TeamStatus;
  createdAt: string;
  updatedAt: string;
}

export type TeamStatus = 'active' | 'paused' | 'completed' | 'failed';

/**
 * TeamMember - Individual agent in a team
 */
export interface TeamMember {
  agentId: string;               // gkSessionId of the agent
  name: string;                  // Human-readable (e.g., "researcher")
  agentType: string;             // Agent profile name
  role: TeamRole;
  port: number;                  // PTY server port
  pid: number | null;
  status: MemberStatus;
  joinedAt: string;
  lastActiveAt: string;
}

export type TeamRole = 'leader' | 'member';
export type MemberStatus = 'starting' | 'ready' | 'busy' | 'idle' | 'shutdown';

/**
 * TeamTask - Task with dependencies for team coordination
 */
export interface TeamTask {
  taskId: string;
  teamId: string;
  subject: string;               // Brief title (imperative form)
  description: string;           // Detailed description
  activeForm: string;            // Present continuous for UI ("Running tests")
  status: TaskStatus;
  owner: string | null;          // Agent name (not ID)
  createdBy: string;             // Agent name who created task
  blockedBy: string[];           // Task IDs that must complete first
  blocks: string[];              // Task IDs waiting on this
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted';

/**
 * TeamMessage - Inter-agent communication
 */
export interface TeamMessage {
  messageId: string;
  teamId: string;
  type: MessageType;
  senderId: string;              // Agent ID
  senderName: string;            // Human-readable name
  recipientId: string;           // Agent ID or '*' for broadcast
  recipientName: string;         // Human-readable name or 'all'
  content: string;
  summary: string;               // 5-10 word preview for UI
  status: MessageStatus;
  requestId?: string;            // For shutdown/plan protocols
  approve?: boolean;             // For response messages
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

export type MessageType =
  | 'message'
  | 'broadcast'
  | 'shutdown_request'
  | 'shutdown_response'
  | 'plan_approval_request'
  | 'plan_approval_response'
  | 'approval_request'
  | 'approval_response'
  | 'task_created'
  | 'task_claimed'
  | 'task_completed'
  | 'status_update';

export type MessageStatus = 'pending' | 'delivered' | 'processed' | 'failed' | 'stale';

// ============================================================================
// Unified Inbox Types
// ============================================================================

/**
 * InboxMessage - Central inbox message for all team communications
 */
export interface InboxMessage {
  id: string;                    // Unique message ID (e.g., "msg-abc123")
  timestamp: string;             // ISO timestamp
  type: MessageType;
  from: AgentRef;
  to: AgentRef | 'all';          // 'all' for broadcasts
  content: string;               // Full message content
  summary: string;               // Short summary (for display)
  status: MessageStatus;
  metadata?: InboxMetadata;
  deliveredAt?: string;          // When delivered to agent
  processedAt?: string;          // When hook action completed
}

/**
 * AgentRef - Reference to an agent (sender or recipient)
 */
export interface AgentRef {
  id: string;                    // Agent ID
  name: string;                  // Display name (e.g., "researcher-1", "leader")
  role: TeamRole;
}

/**
 * InboxMetadata - Additional data based on message type
 */
export interface InboxMetadata {
  // For approval_request
  toolType?: string;             // 'shell', 'write_file', etc.
  toolDetail?: string;           // Command or file path
  agentPort?: number;            // Agent's PTY port

  // For approval_response
  requestId?: string;            // Links to original request
  approved?: boolean;
  reason?: string;               // Rejection reason

  // For task updates
  taskId?: string;
  blockedBy?: string[];
  unblocked?: string[];          // Tasks unblocked by this completion

  // For status_update
  previousStatus?: MemberStatus;
  newStatus?: MemberStatus;
}

/**
 * InboxFilters - Filters for reading inbox
 */
export interface InboxFilters {
  to?: string;                   // Filter by recipient name
  from?: string;                 // Filter by sender name
  type?: MessageType | MessageType[];
  status?: MessageStatus | MessageStatus[];
  since?: string;                // ISO timestamp
  limit?: number;
}

/**
 * HookResult - Result from processing a message hook
 */
export interface HookResult {
  success: boolean;
  action?: string;               // What action was taken
  error?: string;
}

/**
 * PortAllocation - Track port assignments
 */
export interface PortAllocation {
  port: number;
  agentId: string;
  teamId: string;
  pid: number | null;
  allocatedAt: string;
}

export interface PortRegistry {
  allocations: PortAllocation[];
  lastUpdated: string;
}

/**
 * MessageQueue - Per-agent message queue index
 */
export interface MessageQueue {
  agentId: string;
  teamId: string;
  pending: string[];             // Message IDs awaiting delivery
  delivered: string[];           // Message IDs delivered but not read
  lastChecked: string | null;
}

// ============================================================================
// Input types for tool handlers
// ============================================================================

export interface TeamCreateInput {
  teamName: string;
  description?: string;
  leaderId: string;
  leaderPort: number;
  projectDir: string;
}

export interface TaskCreateInput {
  teamId: string;
  subject: string;
  description: string;
  activeForm?: string;
  createdBy: string;
  blockedBy?: string[];
  metadata?: Record<string, unknown>;
}

export interface TaskUpdateInput {
  status?: TaskStatus;
  subject?: string;
  description?: string;
  activeForm?: string;
  owner?: string | null;
  addBlocks?: string[];
  addBlockedBy?: string[];
  removeBlockedBy?: string[];      // Remove task IDs from blockedBy
  removeBlocks?: string[];         // Remove task IDs from blocks
  metadata?: Record<string, unknown>;
}

export interface MessageCreateInput {
  teamId: string;
  type: MessageType;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  content: string;
  summary: string;
  requestId?: string;
  approve?: boolean;
}

export interface MemberAddInput {
  teamId: string;
  agentId: string;
  name: string;
  agentType: string;
  port: number;
  pid?: number | null;
}

// ============================================================================
// Result types
// ============================================================================

export interface TeamOperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface TaskListResult {
  tasks: TeamTask[];
  available: TeamTask[];         // Unblocked pending tasks without owner
  blocked: TeamTask[];           // Tasks with unresolved dependencies
  inProgress: TeamTask[];        // Tasks being worked on
  completed: TeamTask[];         // Finished tasks
}
