import { OfficeEventEmitter } from '../src/domains/agent-office/event-emitter.js';
import { OfficeWebServer } from '../src/domains/agent-office/renderer/web/server.js';
import { createInitialState } from '../src/domains/agent-office/state-machine.js';
import { WebSocket } from 'ws';
import { OfficeEvent } from '../src/domains/agent-office/types.js';

async function runTests() {
  console.log('Running Agent Office Phase 4 Security & Regression Tests...');
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

  await test('Server starts correctly', async () => {
    actualPort = await server.start();
    console.log(`Server started on port ${actualPort}`);
  });

  await test('Path traversal is blocked (returns 403)', async () => {
    const net = await import('net');
    
    const sendRawRequest = (path: string): Promise<string> => new Promise((resolve, reject) => {
      const client = net.connect(actualPort, 'localhost', () => {
        client.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
      });
      let response = '';
      client.on('data', (data) => { response += data.toString(); });
      client.on('end', () => resolve(response));
      client.on('error', reject);
    });

    // Attempt to access parent directory using raw path
    const response1 = await sendRawRequest('/../package.json');
    if (!response1.includes('HTTP/1.1 403')) {
      throw new Error(`Expected 403 for /../package.json, got: ${response1.split('\r\n')[0]}`);
    }
    
    // Test with multiple dots
    const response2 = await sendRawRequest('/../../package.json');
    if (!response2.includes('HTTP/1.1 403')) {
      throw new Error(`Expected 403 for /../../package.json, got: ${response2.split('\r\n')[0]}`);
    }

    console.log('Path traversal correctly blocked with 403');
  });

  await test('Static files are still served correctly', async () => {
    const res = await fetch(`http://localhost:${actualPort}/index.html`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const text = await res.text();
    if (!text.includes('<title>Agent Office - GemKit</title>')) throw new Error('HTML content mismatch');
  });

  await test('API endpoints still work', async () => {
    const stateRes = await fetch(`http://localhost:${actualPort}/api/state`);
    if (stateRes.status !== 200) throw new Error(`Expected 200, got ${stateRes.status}`);
    const stateData = await stateRes.json();
    if (stateData.isActive !== false) throw new Error('Initial state mismatch');
  });

  await test('WebSocket broadcasts still work', async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${actualPort}`);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket timeout'));
      }, 5000);

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'state') {
          emitter.emit({
            type: 'skill_activated',
            agentId: 'test-agent',
            targetAgentId: null,
            skill: 'sec-test',
            message: 'Testing security',
            timestamp: Date.now()
          } as OfficeEvent);
        }
        if (msg.type === 'event' && msg.data.skill === 'sec-test') {
          ws.close();
          clearTimeout(timeout);
          resolve();
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
