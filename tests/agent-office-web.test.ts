import { OfficeEventEmitter } from '../src/domains/agent-office/event-emitter.js';
import { OfficeWebServer } from '../src/domains/agent-office/renderer/web/server.js';
import { createInitialState } from '../src/domains/agent-office/state-machine.js';
import { WebSocket } from 'ws';
import { OfficeEvent } from '../src/domains/agent-office/types.js';

async function runTests() {
  console.log('Running Agent Office Phase 4 Web Dashboard Tests...');
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.log(`❌ FAIL: ${name}`);
      console.error(err);
      failed++;
    }
  };

  const emitter = new OfficeEventEmitter(createInitialState());
  const server = new OfficeWebServer({
    port: 3847,
    emitter: emitter
  });

  let actualPort: number;

  await test('Server starts on port 3847 (or next available)', async () => {
    actualPort = await server.start();
    if (actualPort < 3847) throw new Error('Port should be >= 3847');
    console.log(`Server started on port ${actualPort}`);
  });

  await test('Static files are served correctly', async () => {
    const res = await fetch(`http://localhost:${actualPort}/index.html`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const text = await res.text();
    if (!text.includes('<title>Agent Office - GemKit</title>')) throw new Error('HTML content mismatch');

    const cssRes = await fetch(`http://localhost:${actualPort}/styles.css`);
    if (cssRes.status !== 200) throw new Error(`Expected 200, got ${cssRes.status}`);
    
    const jsRes = await fetch(`http://localhost:${actualPort}/app.js`);
    if (jsRes.status !== 200) throw new Error(`Expected 200, got ${jsRes.status}`);
  });

  await test('API endpoints respond correctly', async () => {
    const stateRes = await fetch(`http://localhost:${actualPort}/api/state`);
    if (stateRes.status !== 200) throw new Error(`Expected 200, got ${stateRes.status}`);
    const stateData = await stateRes.json();
    if (stateData.isActive !== false) throw new Error('Initial state mismatch');

    const historyRes = await fetch(`http://localhost:${actualPort}/api/history`);
    if (historyRes.status !== 200) throw new Error(`Expected 200, got ${historyRes.status}`);
    const historyData = await historyRes.json();
    if (!Array.isArray(historyData)) throw new Error('History should be an array');
  });

  await test('WebSocket connection and state broadcasting', async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${actualPort}`);
      let stateReceived = false;
      let eventReceived = false;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket test timed out'));
      }, 5000);

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'state') {
          stateReceived = true;
          // After receiving initial state, trigger an event
          emitter.emit({
            type: 'skill_activated',
            agentId: 'test-agent',
            targetAgentId: null,
            skill: 'testing',
            message: 'Testing broadcasting',
            timestamp: Date.now()
          } as OfficeEvent);
        }
        if (msg.type === 'event') {
          if (msg.data.skill === 'testing') {
            eventReceived = true;
            ws.close();
            clearTimeout(timeout);
            if (stateReceived && eventReceived) {
              resolve();
            } else {
              reject(new Error('State or Event not received correctly via WS'));
            }
          }
        }
      });

      ws.on('error', reject);
    });
  });

  server.stop();

  console.log(`\nTests Run: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('❌ Tests failed:', err);
  process.exit(1);
});
