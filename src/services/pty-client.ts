/**
 * PTY Client - Sends commands to the PTY server
 * Ported from claude-pty-wrapper/client.js
 */

import net from 'net';
import type {
  PtyExchange,
  PtyServerStatus,
  PtySendResponse,
  PtyCompleteResponse,
  PtyPendingResponse
} from '../domains/agent/pty-types.js';

const DEFAULT_PORT = 3377;
const DEFAULT_HOST = '127.0.0.1';

export class PtyClient {
  private port: number;
  private host: string;

  constructor(port: number = DEFAULT_PORT, host: string = DEFAULT_HOST) {
    this.port = port;
    this.host = host;
  }

  /**
   * Send command to server and get response
   */
  sendCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      let response = '';

      client.setTimeout(10000);

      client.connect(this.port, this.host, () => {
        client.write(command + '\n');
      });

      client.on('data', (data) => {
        response += data.toString();
        client.destroy();
      });

      client.on('close', () => {
        resolve(response.trim());
      });

      client.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ECONNREFUSED') {
          reject(new Error('No server running. Use "gk agent start" first.'));
        } else {
          reject(err);
        }
      });

      client.on('timeout', () => {
        client.destroy();
        reject(new Error('Connection timeout'));
      });
    });
  }

  /**
   * Check if server is running
   */
  async isServerRunning(): Promise<boolean> {
    try {
      await this.sendCommand('status');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get server status
   */
  async status(): Promise<PtyServerStatus> {
    const response = await this.sendCommand('status');
    return JSON.parse(response) as PtyServerStatus;
  }

  /**
   * Send prompt to session
   */
  async send(prompt: string): Promise<PtySendResponse> {
    const response = await this.sendCommand('send ' + prompt);
    return JSON.parse(response) as PtySendResponse;
  }

  /**
   * Wait for completion
   */
  async waitForCompletion(timeout: number = 120): Promise<boolean> {
    const startTime = Date.now();
    const timeoutMs = timeout * 1000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const result = await this.complete();

        if (result.complete) {
          return true;
        }

        if (result.reason === 'pending_tool') {
          // Tool confirmation needed, return early
          return false;
        }
      } catch (err) {
        throw err;
      }

      await this.sleep(2000);
    }

    return false;
  }

  /**
   * Check if response is complete
   */
  async complete(): Promise<PtyCompleteResponse> {
    const response = await this.sendCommand('complete');
    return JSON.parse(response) as PtyCompleteResponse;
  }

  /**
   * Get structured exchange output
   */
  async exchange(): Promise<PtyExchange> {
    const response = await this.sendCommand('exchange');
    return JSON.parse(response) as PtyExchange;
  }

  /**
   * Check for pending tool confirmations
   */
  async pending(): Promise<PtyPendingResponse> {
    const response = await this.sendCommand('pending');
    return JSON.parse(response) as PtyPendingResponse;
  }

  /**
   * Read raw output
   */
  async read(lines: number = 200): Promise<string> {
    return await this.sendCommand('read ' + lines);
  }

  /**
   * Get exchange history
   */
  async history(): Promise<{ provider: string; count: number; exchanges: PtyExchange[] }> {
    const response = await this.sendCommand('history');
    return JSON.parse(response);
  }

  /**
   * Clear exchange history
   */
  async clearHistory(): Promise<void> {
    await this.sendCommand('history clear');
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    try {
      await this.sendCommand('stop');
    } catch {
      // Server may have already stopped
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
