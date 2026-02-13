/**
 * PTY Types for Interactive Mode
 */

import type { CliProvider } from './types.js';

/**
 * Provider-specific PTY configuration
 */
export interface PtyProviderConfig {
  name: string;
  command: string;
  package: string;              // npm package name for npx
  modelFlag: string;
  toolsFlag: string;
  toolsFormat: 'json' | 'csv';  // JSON array vs comma-separated
  pipeFlag?: string;            // Claude needs -p
  readyIndicator: string;       // ❯ or >
  responseMarker: string;       // ● or ✦
  exitCommand: string;
}

/**
 * Loaded context file
 */
export interface LoadedContext {
  type: 'context';
  name: string;
  path: string;
  content: string;
  originalRef: string;
  relativePath?: string;
}

/**
 * Team context for PTY session
 */
export interface PtyTeamContext {
  teamId: string;
  teamName: string;
  role: 'leader' | 'member';
  agentId: string;
  agentName: string;
  leaderPort: number;
  projectDir: string;
}

/**
 * Session state stored in .gk-interactive-session.json
 */
export interface PtySessionState {
  provider: CliProvider;
  model: string;
  port: number;
  pid: number;
  isFirstSend: boolean;
  context: {
    agentName: string | null;
    agentContent: string | null;
    skills: string[];
    skillContents: Record<string, string>;
    contextFiles: LoadedContext[];
    tools: string[];
  };
  team?: PtyTeamContext;  // Team context when running as team member
  startedAt: string;
}

/**
 * Structured exchange output
 */
export interface PtyExchange {
  id: string;
  timestamp: string;
  prompt: string;
  answer: string;
  pending: PtyPendingTool[];
  toolResults: PtyToolResult[];
  status: 'complete' | 'waiting_confirmation' | 'streaming';
}

/**
 * Pending tool awaiting confirmation
 */
export interface PtyPendingTool {
  type: 'shell' | 'write_file' | 'read_file' | 'read_folder' | 'edit_file' | 'apply_change';
  detail?: string;
  command?: string;
  path?: string;
  waiting: boolean;
  options?: string[];
  actionRequired?: { current: number; total: number };
}

/**
 * Tool execution result
 */
export interface PtyToolResult {
  type: string;
  detail: string;
  status: 'completed' | 'failed' | 'in_progress';
}

/**
 * Real-time event from PTY stream
 */
export interface PtyEvent {
  type: 'stream_started' | 'tool_in_progress' | 'tool_completed' |
        'tool_failed' | 'tool_confirmation_required' | 'action_required' |
        'waiting_confirmation' | 'response_chunk' | 'prompt_ready';
  tool?: string;
  detail?: string;
  command?: string;
  current?: number;
  total?: number;
}

/**
 * Server status response
 */
export interface PtyServerStatus {
  running: boolean;
  ready: boolean;
  provider: CliProvider;
  outputLength: number;
}

/**
 * Send command response
 */
export interface PtySendResponse {
  ok: boolean;
  exchangeId?: string;
  error?: string;
}

/**
 * Completion check response
 */
export interface PtyCompleteResponse {
  complete: boolean;
  reason?: 'streaming' | 'no_response' | 'pending_tool' | 'waiting_content' | 'unknown';
  hint?: string;
}

/**
 * Pending tools response
 */
export interface PtyPendingResponse {
  hasPending: boolean;
  tools: PtyPendingTool[];
  hint?: string;
}
