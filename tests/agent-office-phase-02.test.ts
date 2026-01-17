import { sessionToOfficeState } from '../src/domains/agent-office/session-bridge.js';
import { scanPlanDocuments } from '../src/domains/agent-office/documents-scanner.js';
import { OfficeEventEmitter } from '../src/domains/agent-office/event-emitter.js';
import { SessionFileWatcher } from '../src/domains/agent-office/file-watcher.js';
import { GkSession, GkAgent } from '../src/domains/session/types.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

async function runTests() {
  console.log('Running Agent Office Phase 02 Tests...');
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void | Promise<void>) => {
    try {
      fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.log(`❌ FAIL: ${name}`);
      console.error(err);
      failed++;
    }
  };

  // 1. Orchestrator Detection & Inbox Generation
  test('Orchestrator Detection & Inbox Generation', () => {
    const session: GkSession = {
      gkSessionId: 'session-123',
      gkProjectHash: 'hash',
      projectDir: '/tmp',
      geminiSessionId: null,
      geminiParentId: null,
      geminiProjectHash: null,
      initialized: true,
      initTimestamp: new Date().toISOString(),
      sessionType: 'gemini',
      appName: 'test',
      pid: 1234,
      activePlan: 'plan-abc',
      suggestedPlan: null,
      agents: [
        {
          gkSessionId: 'session-123',
          pid: 1234,
          geminiSessionId: null,
          geminiProjectHash: null,
          parentGkSessionId: null,
          agentType: 'Main Agent',
          agentRole: 'main-agent',
          prompt: 'main prompt',
          model: 'gemini-pro',
          tokenUsage: null,
          retryCount: 0,
          resumeCount: 0,
          generation: 1,
          injected: null,
          startTime: new Date().toISOString(),
          endTime: null,
          status: 'active',
          exitCode: null,
          error: null
        } as GkAgent,
        {
          gkSessionId: 'sub-1',
          pid: 1235,
          geminiSessionId: null,
          geminiProjectHash: null,
          parentGkSessionId: 'session-123',
          agentType: 'Sub Agent',
          agentRole: 'researcher',
          prompt: 'research prompt',
          model: 'gemini-flash',
          tokenUsage: { input: 100, output: 200, total: 300, cached: 0, thoughts: 0, tool: 0 },
          retryCount: 0,
          resumeCount: 0,
          generation: 1,
          injected: { skills: ['search'], context: [] },
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          status: 'completed',
          exitCode: 0,
          error: null
        } as GkAgent
      ]
    };

    const state = sessionToOfficeState(session);

    if (state.orchestrator?.id !== 'session-123') throw new Error('Orchestrator not identified correctly');
    if (state.agents.size !== 1) throw new Error('Sub-agent count mismatch');
    if (state.inbox.length !== 1) throw new Error('Inbox item missing for completed agent');
  });

  // 2. Document Scan
  test('Document Scan: scanPlanDocuments finds files', () => {
    const tempDir = join(process.cwd(), 'temp-test-p2-plan');
    try {
      mkdirSync(tempDir, { recursive: true });
      mkdirSync(join(tempDir, 'research'), { recursive: true });
      
      writeFileSync(join(tempDir, 'plan.md'), '# Plan');
      writeFileSync(join(tempDir, 'phase-01-setup.md'), '# Phase 1');
      writeFileSync(join(tempDir, 'research', 'market-research.md'), '# Market');

      const docs = scanPlanDocuments(tempDir);
      
      if (docs.length !== 3) throw new Error(`Expected 3 documents, got ${docs.length}`);
      const types = docs.map(d => d.type);
      if (!types.includes('plan')) throw new Error('plan.md not found');
      if (!types.includes('phase')) throw new Error('phase-01-setup.md not found');
      if (!types.includes('research')) throw new Error('market-research.md not found');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 3. OfficeEventEmitter: notifies subscribers and MAX_HISTORY_SIZE
  test('OfficeEventEmitter: notifications and MAX_HISTORY_SIZE', () => {
    const initialState = {
      orchestrator: null,
      agents: new Map(),
      sessionId: 'test',
      projectDir: null,
      activePlan: null,
      currentNotification: null,
      inbox: [],
      documents: [],
      isActive: false
    };
    const emitter = new OfficeEventEmitter(initialState as any);
    
    let receivedState: any = null;
    emitter.onStateChange(state => {
      receivedState = state;
    });
    if (receivedState?.sessionId !== 'test') throw new Error('Immediate callback failed');

    for (let i = 0; i < 1100; i++) {
      emitter.emit({
        type: 'agent_working',
        agentId: 'a',
        targetAgentId: null,
        skill: null,
        message: `msg ${i}`,
        timestamp: Date.now()
      });
    }

    const history = emitter.getHistory();
    if (history.length !== 1000) throw new Error(`Expected 1000 history items, got ${history.length}`);
  });

  // 4. FileWatcher: diffSessions logic
  test('FileWatcher: diffSessions logic', () => {
    const watcher = new SessionFileWatcher({
      onSessionChange: () => {},
      onEvent: () => {},
      onError: () => {}
    });

    const prev: GkSession = {
      gkSessionId: 's1',
      agents: [
        { gkSessionId: 'a1', status: 'active', injected: { skills: [], context: [] } } as any
      ]
    } as any;

    const curr: GkSession = {
      gkSessionId: 's1',
      agents: [
        { gkSessionId: 'a1', status: 'completed', injected: { skills: ['test-skill'], context: [] } } as any
      ]
    } as any;

    const diffs = (watcher as any).diffSessions(prev, curr);
    
    if (diffs.length === 0) throw new Error('No diffs detected');
    if (!diffs.some((d: any) => d.type === 'task_complete')) throw new Error('task_complete event missing');
    if (!diffs.some((d: any) => d.type === 'skill_activated' && d.skill === 'test-skill')) throw new Error('skill_activated event missing');
  });

  console.log(`\nTests Run: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('❌ Tests failed:', err);
  process.exit(1);
});
