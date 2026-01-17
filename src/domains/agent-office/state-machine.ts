import { AgentState, OfficeState, OfficeAgent, OfficeEvent, OfficeNotification, OfficeEventType } from './types.js';

// Valid state transitions
const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  idle: ['working', 'walking', 'receiving'],
  working: ['idle', 'delivering', 'walking'],
  walking: ['idle', 'working', 'delivering'],
  delivering: ['idle', 'walking'],
  receiving: ['working', 'idle'],
};

export function isValidTransition(from: AgentState, to: AgentState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function createInitialState(): OfficeState {
  return {
    orchestrator: null,
    agents: new Map(),
    sessionId: null,
    projectDir: null,
    activePlan: null,
    appName: null,
    currentNotification: null,
    inbox: [],
    documents: [],
    isActive: false,
  };
}

export function transitionAgent(agent: OfficeAgent, event: OfficeEvent): OfficeAgent {
  // Map event type to new state
  const stateMap: Partial<Record<OfficeEventType, AgentState>> = {
    agent_idle: 'idle',
    agent_working: 'working',
    skill_activated: 'working',
    handoff_start: 'walking',
    received_work: 'receiving',
    delivering: 'delivering',
    task_complete: 'idle',
  };

  const newState = stateMap[event.type];
  if (!newState) return agent;

  if (!isValidTransition(agent.state, newState)) {
    return agent; // Invalid transition, no change
  }

  return {
    ...agent,
    state: newState,
    activeSkill: event.skill ?? agent.activeSkill,
    hasFireEffect: event.type === 'skill_activated',
    speechBubble: event.message || null,
  };
}

export function processEvent(state: OfficeState, event: OfficeEvent): OfficeState {
  // Update agent state
  const agent = state.agents.get(event.agentId);
  if (agent) {
    state.agents.set(event.agentId, transitionAgent(agent, event));
  } else if (state.orchestrator && state.orchestrator.id === event.agentId) {
    state.orchestrator = transitionAgent(state.orchestrator, event) as any; // Cast as any to handle type overlap
  }

  // Generate notification if needed
  const notification = generateNotification(event);
  if (notification) {
    state.currentNotification = notification;
  }

  return { ...state };
}

function generateNotification(event: OfficeEvent): OfficeNotification | null {
  const notificationMap: Partial<Record<OfficeEventType, { type: OfficeNotification['type']; template: string }>> = {
    skill_activated: { type: 'skill', template: `Skill activated: ${event.skill}` },
    handoff_start: { type: 'handoff', template: 'Agent delivering information...' },
    handoff_complete: { type: 'handoff', template: 'Handoff complete!' },
    task_complete: { type: 'success', template: 'Task completed! Check your inbox' },
  };

  const config = notificationMap[event.type];
  if (!config) return null;

  return {
    message: config.template,
    type: config.type,
    timestamp: event.timestamp,
  };
}
