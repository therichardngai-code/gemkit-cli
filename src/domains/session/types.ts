/**
 * Session type definitions
 * Aligned with gk-session-manager.cjs session structure
 */

/**
 * GK Session - matches gk-session-manager.cjs session structure
 */
export interface GkSession {
  // GemKit identification
  gkSessionId: string;
  gkProjectHash: string;
  projectDir: string;

  // Gemini mapping
  geminiSessionId: string | null;
  geminiParentId: string | null;
  geminiProjectHash: string | null;
  geminiTempDir?: string;

  // Session metadata
  initialized: boolean;
  initTimestamp: string;
  sessionType: 'gemini' | 'non-gemini';
  appName: string;
  pid: number;

  // Plan management
  activePlan: string | null;
  suggestedPlan: string | null;
  planDateFormat?: string;

  // Agents array (always last)
  agents: GkAgent[];
}

/**
 * GK Agent - matches gk-session-manager.cjs agent structure
 */
export interface GkAgent {
  gkSessionId: string;
  pid: number | null;
  geminiSessionId: string | null;
  geminiProjectHash: string | null;
  parentGkSessionId: string | null;
  agentType: 'Main Agent' | 'Sub Agent';
  agentRole: string;
  prompt: string | null;
  model: string | null;
  tokenUsage: TokenUsage | null;
  retryCount: number;
  resumeCount: number;
  generation: number;
  injected: InjectedContext | null;
  startTime: string;
  endTime: string | null;
  status: 'active' | 'completed' | 'failed';
  exitCode: number | null;
  error: string | null;
}

/**
 * Token usage structure
 */
export interface TokenUsage {
  input: number;
  output: number;
  cached: number;
  thoughts: number;
  tool: number;
  total: number;
}

/**
 * Injected context tracking
 */
export interface InjectedContext {
  skills: string[];
  context: string[];
  contextHash?: string;
}

/**
 * GK Project - matches gk-session-manager.cjs project structure
 */
export interface GkProject {
  gkProjectHash: string;
  projectDir: string;
  projectPath: string;
  geminiProjectHash: string | null;

  initialized: boolean;
  initTimestamp: string;
  lastActiveTimestamp: string;
  activeGkSessionId: string | null;

  sessions: GkProjectSession[];
}

/**
 * Session summary in project file
 */
export interface GkProjectSession {
  gkSessionId: string;
  pid: number | null;
  sessionType: 'gemini' | 'non-gemini';
  appName: string;
  prompt: string | null;
  activePlan: string | null;
  startTime: string;
  endTime: string | null;
}

/**
 * Session list options
 */
export interface SessionListOptions {
  limit?: number;
  status?: 'active' | 'completed' | 'failed' | 'all';
}

/**
 * Agent filter options
 */
export interface AgentFilterOptions {
  agentType?: 'Main Agent' | 'Sub Agent';
  status?: 'active' | 'completed' | 'failed';
}

/**
 * Session metrics
 */
export interface SessionMetrics {
  total: number;
  active: number;
  completed: number;
  failed: number;
  mainAgents: number;
  subAgents: number;
  totalDurationMs: number;
}
