import { GkSession, GkAgent } from '../session/types.js';
import {
  OfficeState,
  OfficeAgent,
  OrchestratorAgent,
  InboxItem,
  AgentState,
  CharacterType,
} from './types.js';
import { createInitialState } from './state-machine.js';
import { getIconForRole, formatDisplayName } from './icons.js';

/**
 * Map agent role to character type
 * Must match JS role detection: research, code/executor, plan, test, design/ui/ux
 */
export function getCharacterType(role: string): CharacterType {
  const r = role.toLowerCase();
  // Only main agent is orchestrator
  if (r.includes('main')) return 'orchestrator';
  // Match roles to JS detection logic
  if (r.includes('research') || r.includes('scout')) return 'researcher';
  if (r.includes('code') || r.includes('executor') || r.includes('debug')) return 'coder';
  if (r.includes('plan')) return 'planner';
  if (r.includes('test')) return 'tester';
  if (r.includes('design') || r.includes('ui') || r.includes('ux') || r.includes('artist')) return 'designer';
  // Legacy mappings
  if (r.includes('doc') || r.includes('writer')) return 'writer';
  if (r.includes('manager') || r.includes('git')) return 'manager';
  // Everything else goes to other
  return 'other';
}

/**
 * Check if agent is the orchestrator (Main Agent)
 */
export function isOrchestrator(agent: GkAgent, session: GkSession): boolean {
  return (
    agent.agentType === 'Main Agent' ||
    agent.parentGkSessionId === null ||
    agent.gkSessionId === session.gkSessionId
  );
}

/**
 * Map GkAgent status to OfficeAgent state
 */
function mapStatusToState(status: GkAgent['status'], hasActiveSkill: boolean): AgentState {
  if (status === 'active') {
    return hasActiveSkill ? 'working' : 'working';
  }
  if (status === 'completed') return 'idle';
  if (status === 'failed') return 'idle';
  return 'idle';
}

/**
 * Calculate progress from agent timing
 */
function calculateProgress(agent: GkAgent): number {
  if (agent.status === 'completed') return 100;
  if (agent.status === 'failed') return 0;
  if (!agent.startTime) return 0;

  const start = new Date(agent.startTime).getTime();
  const now = Date.now();
  const elapsed = now - start;

  // Estimate based on typical task duration (2 min default)
  const estimatedMs = 120000;
  return Math.min(100, Math.round((elapsed / estimatedMs) * 100));
}

/**
 * Generate speech bubble based on agent state
 */
function generateSpeechBubble(agent: GkAgent): string | null {
  if (agent.status === 'completed') return 'Task complete!';
  if (agent.status === 'failed') return 'Task failed';
  if (agent.injected?.skills?.length) {
    return `Working on ${agent.injected.skills[0]}...`;
  }
  return null;
}

/**
 * Convert single GkAgent to OfficeAgent
 */
export function agentToOfficeAgent(
  agent: GkAgent,
  session: GkSession
): OfficeAgent | OrchestratorAgent {
  const isOrch = isOrchestrator(agent, session);
  const hasActiveSkill = !!(agent.injected?.skills?.length && agent.status === 'active');
  const role = agent.agentRole || 'unknown';

  const base: OfficeAgent = {
    id: agent.gkSessionId,
    agentType: isOrch ? 'orchestrator' : 'sub-agent',
    role,
    characterType: getCharacterType(role),
    icon: getIconForRole(role, isOrch),
    state: mapStatusToState(agent.status, hasActiveSkill),
    activeSkill: agent.injected?.skills?.[0] || null,
    progress: calculateProgress(agent),
    speechBubble: generateSpeechBubble(agent),
    hasFireEffect: hasActiveSkill,
    gkSessionId: agent.gkSessionId,
    parentSessionId: agent.parentGkSessionId,
  };

  if (isOrch) {
    const subAgents = session.agents.filter(a => !isOrchestrator(a, session));
    return {
      ...base,
      agentType: 'orchestrator',
      delegatedTo: subAgents.filter(a => a.status === 'active').map(a => a.gkSessionId),
      totalSubAgents: subAgents.length,
      completedSubAgents: subAgents.filter(a => a.status === 'completed').length,
    } as OrchestratorAgent;
  }

  return base;
}

/**
 * Generate inbox item from completed agent
 */
export function agentToInboxItem(agent: GkAgent): InboxItem {
  const duration = agent.endTime && agent.startTime
    ? new Date(agent.endTime).getTime() - new Date(agent.startTime).getTime()
    : 0;

  return {
    id: `inbox-${agent.gkSessionId}`,
    agentId: agent.gkSessionId,
    agentRole: agent.agentRole || 'unknown',
    agentIcon: getIconForRole(agent.agentRole || ''),
    timestamp: agent.endTime ? new Date(agent.endTime).getTime() : Date.now(),
    status: 'unread',
    title: `${formatDisplayName(agent.agentRole || 'Agent')} completed`,
    preview: agent.prompt ? agent.prompt.slice(0, 100) : 'Task completed',
    fullContent: null,
    tokenUsage: agent.tokenUsage
      ? { input: agent.tokenUsage.input, output: agent.tokenUsage.output }
      : null,
    duration,
    skillsUsed: agent.injected?.skills || [],
  };
}

/**
 * Convert full GkSession to OfficeState
 */
export function sessionToOfficeState(session: GkSession | null): OfficeState {
  const state = createInitialState();

  if (!session) return state;

  state.sessionId = session.gkSessionId;
  state.projectDir = session.projectDir;
  state.activePlan = session.activePlan;
  state.appName = session.appName || null;  // IDE name from gk session init
  state.isActive = session.agents.some(a => a.status === 'active');

  // Process agents
  for (const agent of session.agents) {
    const officeAgent = agentToOfficeAgent(agent, session);

    if (officeAgent.agentType === 'orchestrator') {
      state.orchestrator = officeAgent as OrchestratorAgent;
    } else {
      state.agents.set(officeAgent.id, officeAgent);
    }

    // Add completed agents to inbox
    if (agent.status === 'completed') {
      const existingItem = state.inbox.find(i => i.agentId === agent.gkSessionId);
      if (!existingItem) {
        state.inbox.push(agentToInboxItem(agent));
      }
    }
  }

  // Sort inbox by timestamp descending
  state.inbox.sort((a, b) => b.timestamp - a.timestamp);

  return state;
}
