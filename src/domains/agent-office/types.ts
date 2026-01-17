/**
 * Agent Office type definitions
 */

// Agent state union
export type AgentState = 'idle' | 'working' | 'walking' | 'delivering' | 'receiving';

// Character types for gamified UI
export type CharacterType = 'orchestrator' | 'researcher' | 'coder' | 'planner' | 'tester' | 'designer' | 'other' | 'reviewer' | 'artist' | 'writer' | 'manager';

export interface CharacterPosition {
  x: number;
  y: number;
  desk: string;
  facing: 'left' | 'right' | 'front';
}

export type AnimationState = 'idle' | 'typing' | 'walking' | 'celebrating';

// Office agent (sub-agent or orchestrator)
export interface OfficeAgent {
  id: string;
  agentType: 'orchestrator' | 'sub-agent';
  role: string;           // Dynamic from agentRole
  characterType?: CharacterType; // Assigned based on role
  icon: string;           // Auto-assigned or custom
  state: AgentState;
  activeSkill: string | null;
  progress: number;       // 0-100
  speechBubble: string | null;
  hasFireEffect: boolean;
  gkSessionId: string;
  parentSessionId: string | null;
}

// Orchestrator extends OfficeAgent
export interface OrchestratorAgent extends OfficeAgent {
  agentType: 'orchestrator';
  delegatedTo: string[];
  totalSubAgents: number;
  completedSubAgents: number;
}

// Office event for state changes
export interface OfficeEvent {
  type: OfficeEventType;
  agentId: string;
  targetAgentId: string | null;
  skill: string | null;
  message: string;
  timestamp: number;
  characterType?: CharacterType;  // For walking animation to match desk character
}

// Event type union
export type OfficeEventType =
  | 'agent_idle'
  | 'agent_working'
  | 'skill_activated'
  | 'handoff_start'
  | 'handoff_complete'
  | 'received_work'
  | 'delivering'
  | 'task_complete'
  | 'session_complete';

// Inbox item for delivered results
export interface InboxItem {
  id: string;
  agentId: string;
  agentRole: string;
  agentIcon: string;
  timestamp: number;
  status: 'unread' | 'read';
  title: string;
  preview: string;
  fullContent: string | null;
  tokenUsage: { input: number; output: number } | null;
  duration: number;
  skillsUsed: string[];
}

// Document from active plan folder
export interface PlanDocument {
  id: string;
  name: string;
  displayName: string;
  type: DocumentType;
  icon: string;
  path: string;
  relativePath: string;
  modifiedAt: number;
  createdAt: number;
  size: number;
  extension: string;
  phaseNumber: number | null;
}

export type DocumentType = 'plan' | 'phase' | 'research' | 'artifact' | 'report' | 'other';

// Complete office state
export interface OfficeState {
  orchestrator: OrchestratorAgent | null;
  agents: Map<string, OfficeAgent>;
  sessionId: string | null;
  projectDir: string | null;
  activePlan: string | null;
  appName: string | null;  // IDE/app name from session init (e.g., "antigravity", "cursor")
  currentNotification: OfficeNotification | null;
  inbox: InboxItem[];
  documents: PlanDocument[];
  isActive: boolean;
}

// Notification banner
export interface OfficeNotification {
  message: string;
  type: 'skill' | 'handoff' | 'success' | 'info';
  timestamp: number;
}
