import {
  horizontalLine,
  progressBar,
  renderAgentDesk
} from '../src/domains/agent-office/renderer/terminal/components.js';
import { renderInboxPanel } from '../src/domains/agent-office/renderer/terminal/inbox-panel.js';
import { renderDocsPanel } from '../src/domains/agent-office/renderer/terminal/docs-panel.js';
import { OfficeAgent, InboxItem, PlanDocument } from '../src/domains/agent-office/types.js';

async function runTests() {
  console.log('Running Agent Office Phase 03 Tests...');
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

  // 1. horizontalLine()
  test('horizontalLine() returns correct length', () => {
    const line = horizontalLine(10);
    if (line.length !== 10) throw new Error(`Expected length 10, got ${line.length}`);
    if (line !== '\u2500'.repeat(10)) throw new Error('Incorrect character used');
  });

  // 2. progressBar()
  test('progressBar() 50% shows half-filled', () => {
    const bar = progressBar(50, 10);
    // [█████░░░░░] 50% - but it includes colors (pc.cyan/pc.gray)
    // We check if it contains expected number of blocks and the percentage string
    if (!bar.includes('50%')) throw new Error('Percentage missing');
    // Block characters: \u2588 (filled), \u2591 (empty)
    const filledCount = (bar.match(/\u2588/g) || []).length;
    const emptyCount = (bar.match(/\u2591/g) || []).length;
    if (filledCount !== 5) throw new Error(`Expected 5 filled blocks, got ${filledCount}`);
    if (emptyCount !== 5) throw new Error(`Expected 5 empty blocks, got ${emptyCount}`);
  });

  // 3. renderAgentDesk()
  test('renderAgentDesk() returns valid ASCII array', () => {
    const agent: OfficeAgent = {
      id: 'a1',
      agentType: 'sub-agent',
      role: 'researcher',
      icon: '🔍',
      state: 'working',
      activeSkill: 'web-search',
      progress: 45,
      speechBubble: 'Searching...', 
      hasFireEffect: true,
      gkSessionId: 's1',
      parentSessionId: 'p1'
    };
    const lines = renderAgentDesk(agent, 30);
    if (!Array.isArray(lines)) throw new Error('Expected array of strings');
    if (lines.length < 5) throw new Error('Too few lines for desk');
    if (!lines[0].includes('\u250C')) throw new Error('Missing top-left corner');
    if (!lines[lines.length - 1].includes('\u2514')) throw new Error('Missing bottom-left corner');
  });

  // 4. renderInboxPanel()
  test('renderInboxPanel() handles empty items', () => {
    const lines = renderInboxPanel([], 0, 40, 20);
    const content = lines.join('\n');
    if (!content.includes('INBOX (0 messages')) throw new Error('Incorrect header for empty inbox');
  });

  // 5. renderDocsPanel()
  test('renderDocsPanel() groups documents correctly', () => {
    const docs: PlanDocument[] = [
      {
        id: 'd1',
        name: 'plan',
        displayName: 'Main Plan',
        type: 'plan',
        icon: '📋',
        path: '/p/plan.md',
        relativePath: 'plan.md',
        modifiedAt: Date.now(),
        createdAt: Date.now(),
        size: 100,
        extension: 'md',
        phaseNumber: null
      },
      {
        id: 'd2',
        name: 'phase-01',
        displayName: 'Phase 1',
        type: 'phase',
        icon: '📑',
        path: '/p/phase-01.md',
        relativePath: 'phase-01.md',
        modifiedAt: Date.now(),
        createdAt: Date.now(),
        size: 100,
        extension: 'md',
        phaseNumber: 1
      }
    ];
    const lines = renderDocsPanel(docs, 'Test Plan', 0, 40, 20);
    const content = lines.join('\n');
    if (!content.includes('Main Plan')) throw new Error('Main Plan section missing');
    if (!content.includes('Phases')) throw new Error('Phases section missing');
    if (!content.includes('Test Plan')) throw new Error('Plan name missing');
  });

  console.log(`\nTests Run: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('❌ Tests failed:', err);
  process.exit(1);
});
