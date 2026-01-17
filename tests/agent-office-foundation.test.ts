import { 
  isValidTransition, 
  getIconForRole, 
  formatDisplayName 
} from '../src/domains/agent-office/index.js';

async function runTests() {
  console.log('Running Agent Office Foundation Tests...');

  // 1. State transitions
  const idleToWorking = isValidTransition('idle', 'working');
  console.log(`isValidTransition('idle', 'working'): ${idleToWorking} (Expected: true)`);
  if (!idleToWorking) throw new Error('idle -> working should be valid');

  const idleToDelivering = isValidTransition('idle', 'delivering');
  console.log(`isValidTransition('idle', 'delivering'): ${idleToDelivering} (Expected: false)`);
  if (idleToDelivering) throw new Error('idle -> delivering should be invalid');

  // 2. Icon mapping
  const researcherIcon = getIconForRole('researcher');
  console.log(`getIconForRole('researcher'): ${researcherIcon} (Expected: 🔍)`);
  if (researcherIcon !== '\uD83D\uDD0D') throw new Error('researcher icon mismatch');

  const codeExecutorIcon = getIconForRole('code-executor');
  console.log(`getIconForRole('code-executor'): ${codeExecutorIcon} (Expected: 💻)`);
  if (codeExecutorIcon !== '\uD83D\uDCBB') throw new Error('code-executor icon mismatch');

  // 3. Display name formatting
  const formatted = formatDisplayName('code-executor');
  console.log(`formatDisplayName('code-executor'): ${formatted} (Expected: Code Executor)`);
  if (formatted !== 'Code Executor') throw new Error('display name format mismatch');

  console.log('✅ All foundation tests passed!');
}

runTests().catch(err => {
  console.error('❌ Tests failed:', err);
  process.exit(1);
});
