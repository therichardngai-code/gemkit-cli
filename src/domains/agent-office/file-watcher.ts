import { existsSync, readFileSync, statSync } from 'fs';
import { GkSession, GkAgent } from '../session/types.js';
import { OfficeEvent, OfficeEventType, CharacterType } from './types.js';
import { getSessionPath } from '../../utils/paths.js';
import { readEnv } from '../session/env.js';
import { getCharacterType } from './session-bridge.js';

// Polling interval - 200ms for fast detection
const POLL_INTERVAL_MS = 200;

export interface FileWatcherOptions {
  onSessionChange: (session: GkSession) => void;
  onEvent: (event: OfficeEvent) => void;
  onError: (error: Error) => void;
}

export class SessionFileWatcher {
  private pollInterval: NodeJS.Timeout | null = null;
  private previousSession: GkSession | null = null;
  private previousMtime: number = 0;
  private options: FileWatcherOptions;
  private sessionPath: string | null = null;

  constructor(options: FileWatcherOptions) {
    this.options = options;
  }

  /**
   * Start watching the active session file
   * Uses polling for reliable cross-platform support (fs.watch is unreliable on Windows)
   */
  start(): boolean {
    const env = readEnv();
    const projectDir = env.PROJECT_DIR;
    const gkSessionId = env.ACTIVE_GK_SESSION_ID;

    if (!projectDir || !gkSessionId) {
      this.options.onError(new Error('No active session found'));
      return false;
    }

    this.sessionPath = getSessionPath(projectDir, gkSessionId);

    if (!existsSync(this.sessionPath)) {
      this.options.onError(new Error(`Session file not found: ${this.sessionPath}`));
      return false;
    }

    // Load initial session and store mtime
    try {
      const stat = statSync(this.sessionPath);
      this.previousMtime = stat.mtimeMs;
    } catch (e) {
      // Ignore stat errors on initial load
    }
    this.loadSession();

    // Start polling for file changes (more reliable than fs.watch on Windows)
    this.pollInterval = setInterval(() => {
      this.checkForChanges();
    }, POLL_INTERVAL_MS);

    return true;
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Check if file has changed by comparing modification time
   */
  private checkForChanges(): void {
    if (!this.sessionPath) return;

    try {
      const stat = statSync(this.sessionPath);
      const currentMtime = stat.mtimeMs;

      // Only reload if file was modified
      if (currentMtime > this.previousMtime) {
        this.previousMtime = currentMtime;
        this.loadSession();
      }
    } catch (e) {
      // File might be temporarily unavailable during write
    }
  }

  /**
   * Load session and emit events for changes
   */
  private loadSession(): void {
    if (!this.sessionPath) return;

    try {
      const content = readFileSync(this.sessionPath, 'utf-8');
      const session = JSON.parse(content) as GkSession;

      // Generate events from diff BEFORE updating state
      const events = this.previousSession
        ? this.diffSessions(this.previousSession, session)
        : [];

      // Update state FIRST so events can reference the new state
      this.previousSession = session;
      this.options.onSessionChange(session);

      // Then emit events (now state.agents will have the agent)
      for (const event of events) {
        this.options.onEvent(event);
      }
    } catch (e) {
      this.options.onError(e as Error);
    }
  }

  /**
   * Diff two sessions and generate events
   */
  private diffSessions(prev: GkSession, curr: GkSession): OfficeEvent[] {
    const events: OfficeEvent[] = [];
    const timestamp = Date.now();

    // Map previous agents by ID
    const prevAgents = new Map(prev.agents.map(a => [a.gkSessionId, a]));

    for (const agent of curr.agents) {
      const prevAgent = prevAgents.get(agent.gkSessionId);

      if (!prevAgent) {
        // New agent added
        events.push(this.createEvent('received_work', agent, timestamp));

        if (agent.injected?.skills?.length) {
          events.push(this.createEvent('skill_activated', agent, timestamp, agent.injected.skills[0]));
        }
      } else {
        // Check for status changes
        if (prevAgent.status === 'active' && agent.status === 'completed') {
          events.push(this.createEvent('task_complete', agent, timestamp));
          events.push(this.createEvent('delivering', agent, timestamp));
        }

        // Check for skill changes
        const prevSkills = prevAgent.injected?.skills || [];
        const currSkills = agent.injected?.skills || [];
        const newSkills = currSkills.filter(s => !prevSkills.includes(s));

        for (const skill of newSkills) {
          events.push(this.createEvent('skill_activated', agent, timestamp, skill));
        }
      }
    }

    // Check for session completion
    const allCompleted = curr.agents.every(a => a.status === 'completed' || a.status === 'failed');
    const wasActive = prev.agents.some(a => a.status === 'active');

    if (allCompleted && wasActive && curr.agents.length > 0) {
      events.push({
        type: 'session_complete',
        agentId: curr.gkSessionId,
        targetAgentId: null,
        skill: null,
        message: 'All tasks completed',
        timestamp,
      });
    }

    return events;
  }

  /**
   * Create event from agent
   */
  private createEvent(
    type: OfficeEventType,
    agent: GkAgent,
    timestamp: number,
    skill?: string
  ): OfficeEvent {
    const messages: Record<OfficeEventType, string> = {
      agent_idle: 'Waiting for work',
      agent_working: 'Working...',
      skill_activated: `Activated skill: ${skill || 'unknown'}`,
      handoff_start: 'Passing work...',
      handoff_complete: 'Handoff complete!',
      received_work: 'Received work',
      delivering: 'Delivering results...',
      task_complete: 'Task complete!',
      session_complete: 'All tasks completed',
    };

    return {
      type,
      agentId: agent.gkSessionId,
      targetAgentId: agent.parentGkSessionId,
      skill: skill || agent.injected?.skills?.[0] || null,
      message: messages[type],
      timestamp,
      characterType: getCharacterType(agent.agentRole || 'coder'),
    };
  }
}
