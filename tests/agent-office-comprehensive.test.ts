import {
  isValidTransition,
  getIconForRole,
  formatDisplayName,
  transitionAgent,
  createInitialState
} from '../src/domains/agent-office/index.js';
import { mergeConfig } from '../src/domains/config/schema.js';
import { OfficeAgent, OfficeEvent } from '../src/domains/agent-office/types.js';

async function runTests() {
  console.log('Running Comprehensive Agent Office Foundation Tests...');
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void) => {
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

  // 1. Basic Criteria
  test('isValidTransition idle -> working', () => {
    if (!isValidTransition('idle', 'working')) throw new Error('Should be true');
  });

  test('isValidTransition idle -> delivering', () => {
    if (isValidTransition('idle', 'delivering')) throw new Error('Should be false');
  });

  test('getIconForRole researcher', () => {
    if (getIconForRole('researcher') !== '🔍') throw new Error('Mismatch');
  });

  test('formatDisplayName code-executor', () => {
    if (formatDisplayName('code-executor') !== 'Code Executor') throw new Error('Mismatch');
  });

  // 2. State Transition Valid: idle -> working via skill_activated
  test('State Transition Valid: idle -> working via skill_activated', () => {
    const agent: OfficeAgent = {
      id: 'agent-1',
      agentType: 'sub-agent',
      role: 'researcher',
      icon: '🔍',
      state: 'idle',
      activeSkill: null,
      progress: 0,
      speechBubble: null,
      hasFireEffect: false,
      gkSessionId: 'session-1',
      parentSessionId: null
    };

    const event: OfficeEvent = {
      type: 'skill_activated',
      agentId: 'agent-1',
      targetAgentId: null,
      skill: 'web-search',
      message: 'Searching...', 
      timestamp: Date.now()
    };

    const nextAgent = transitionAgent(agent, event);
    if (nextAgent.state !== 'working') throw new Error('State should be working');
    if (nextAgent.activeSkill !== 'web-search') throw new Error('Skill mismatch');
    if (!nextAgent.hasFireEffect) throw new Error('Should have fire effect');
  });

  // 3. State Transition Invalid: idle -> delivering (no change)
  test('State Transition Invalid: idle -> delivering (no change)', () => {
    const agent: OfficeAgent = {
      id: 'agent-1',
      agentType: 'sub-agent',
      role: 'researcher',
      icon: '🔍',
      state: 'idle',
      activeSkill: null,
      progress: 0,
      speechBubble: null,
      hasFireEffect: false,
      gkSessionId: 'session-1',
      parentSessionId: null
    };

    const event: OfficeEvent = {
      type: 'delivering',
      agentId: 'agent-1',
      targetAgentId: null,
      skill: null,
      message: 'Delivering...', 
      timestamp: Date.now()
    };

    const nextAgent = transitionAgent(agent, event);
    if (nextAgent.state !== 'idle') throw new Error('State should remain idle');
  });

  // 4. Icon Assignment: role names map to correct icons
  test('Icon Assignment: various roles', () => {
    if (getIconForRole('code-executor') !== '💻') throw new Error('code mismatch');
    if (getIconForRole('planner') !== '📋') throw new Error('plan mismatch');
    if (getIconForRole('tester') !== '🧪') throw new Error('test mismatch');
    if (getIconForRole('designer') !== '🎨') throw new Error('design mismatch');
    if (getIconForRole('unknown') !== '🤖') throw new Error('default mismatch');
  });

  // 5. Config Merge: partial config merges with defaults
  test('Config Merge: partial office config', () => {
    const partial = {
      office: {
        port: 9999,
        enabled: false
      }
    };
    const merged = mergeConfig(partial as any);
    if (merged.office?.port !== 9999) throw new Error('Port not merged');
    if (merged.office?.enabled !== false) throw new Error('Enabled not merged');
    if (merged.office?.mode !== 'web') throw new Error('Default mode should be web');
    if (merged.office?.refreshRate !== 500) throw new Error('Default refreshRate should be 500');
  });

  console.log(`
Tests Run: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('❌ Tests failed:', err);
  process.exit(1);
});
