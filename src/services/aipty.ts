/**
 * AIPTY - Cross-platform PTY wrapper for Claude Code and Gemini CLI
 * Ported from claude-pty-wrapper/index.js
 */

import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import type { CliProvider } from '../domains/agent/types.js';
import type { PtyProviderConfig } from '../domains/agent/pty-types.js';
import { PTY_PROVIDERS } from '../domains/agent/pty-providers.js';

export interface AIPTYOptions {
  provider: CliProvider;
  model?: string;
  tools?: string[];
  cwd?: string;
  debug?: boolean;
}

export class AIPTY extends EventEmitter {
  private process: pty.IPty | null = null;
  private output: string = '';
  private outputBuffer: Array<{ time: number; data: string }> = [];
  private isReady: boolean = false;
  private provider: CliProvider;
  private config: PtyProviderConfig;
  private model: string;
  private tools: string[];
  private cwd: string;
  private debug: boolean;

  constructor(options: AIPTYOptions) {
    super();
    this.provider = options.provider;
    this.config = PTY_PROVIDERS[options.provider];
    if (!this.config) {
      throw new Error(`Unknown provider: ${options.provider}. Use 'claude' or 'gemini'`);
    }
    this.model = options.model || '';
    this.tools = options.tools || [];
    this.cwd = options.cwd || process.cwd();
    this.debug = options.debug || false;
  }

  /**
   * Start AI CLI session
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.process) {
        reject(new Error('Session already running'));
        return;
      }

      // Use npx to run the CLI package
      const shell = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const args = ['-y', this.config.package];

      // Add pipe flag if needed (Claude)
      if (this.config.pipeFlag) {
        args.push(this.config.pipeFlag);
      }

      // Add model flag
      if (this.model) {
        args.push(this.config.modelFlag, this.model);
      }

      // Add tools if any
      if (this.tools.length > 0) {
        if (this.config.toolsFormat === 'json') {
          args.push(this.config.toolsFlag, JSON.stringify(this.tools));
        } else {
          args.push(this.config.toolsFlag, this.tools.join(','));
        }
      }

      if (this.debug) {
        console.log(`[DEBUG] Spawning: ${shell} ${args.join(' ')}`);
      }

      try {
        this.process = pty.spawn(shell, args, {
          name: 'xterm-256color',
          cols: 120,
          rows: 40,
          cwd: this.cwd,
          env: { ...process.env, TERM: 'xterm-256color' }
        });
      } catch (err) {
        reject(new Error(`Failed to spawn ${shell}: ${(err as Error).message}`));
        return;
      }

      this.output = '';
      this.outputBuffer = [];

      this.process.onData((data: string) => {
        this.output += data;
        this.outputBuffer.push({ time: Date.now(), data });

        if (this.debug) {
          process.stdout.write(data);
        }

        this.emit('data', data);

        // Check if ready (prompt appeared)
        if (!this.isReady && this.output.includes(this.config.readyIndicator)) {
          this.isReady = true;
          this.emit('ready');
        }
      });

      this.process.onExit(({ exitCode }) => {
        this.isReady = false;
        this.process = null;
        this.emit('exit', exitCode);
      });

      // Wait for ready or timeout
      const timeout = setTimeout(() => {
        if (!this.isReady) {
          // Check if trust prompt appeared (Claude specific)
          if (this.output.includes('Yes, I trust')) {
            this.write('1'); // Auto-trust
            setTimeout(() => {
              if (this.isReady) resolve();
              else reject(new Error(`Timeout waiting for ${this.config.name} to be ready`));
            }, 5000);
          } else {
            reject(new Error(`Timeout waiting for ${this.config.name} to start`));
          }
        }
      }, 60000); // 60s timeout for npx downloads

      this.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * Send text (raw write)
   */
  write(text: string): void {
    if (!this.process) {
      throw new Error('No active session');
    }
    this.process.write(text);
  }

  /**
   * Send a prompt and wait for response
   */
  send(prompt: string, options: { timeout?: number } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.isReady) {
        reject(new Error('No active session or not ready'));
        return;
      }

      const timeout = options.timeout || 120000;
      const responseStart = this.output.length;

      this.write(prompt);

      setTimeout(() => {
        this.write('\r');

        if (this.debug) {
          console.log('\n[DEBUG] Prompt sent, waiting for response...');
        }
      }, 500);

      const checkInterval = setInterval(() => {
        const newOutput = this.output.slice(responseStart);

        // Check completion based on provider
        let isComplete = false;
        if (this.provider === 'claude') {
          const hasResponse = newOutput.includes('●');
          const promptAfterResponse = newOutput.lastIndexOf('❯') > newOutput.lastIndexOf('●');
          isComplete = hasResponse && promptAfterResponse;
        } else if (this.provider === 'gemini') {
          // Gemini: look for response block then new prompt
          const hasResponse = newOutput.includes('✦') && newOutput.length > 100;
          isComplete = hasResponse;
        }

        if (isComplete) {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          const answer = this.extractLastAnswer();
          resolve(answer);
        }
      }, 500);

      const timeoutId = setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Timeout waiting for response'));
      }, timeout);
    });
  }

  /**
   * Extract the last answer from output
   */
  extractLastAnswer(): string {
    const cleanOutput = this.output
      .replace(/\x1b\[1C/g, ' ')
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\r/g, '');

    if (this.provider === 'claude') {
      return this.extractAnswerClaude(cleanOutput);
    } else if (this.provider === 'gemini') {
      return this.extractAnswerGemini(cleanOutput);
    }

    return '';
  }

  /**
   * Extract answer from Claude output
   */
  private extractAnswerClaude(cleanOutput: string): string {
    const matches = cleanOutput.match(/●\s*([\s\S]*?)(?=❯|$)/g);
    if (matches && matches.length > 0) {
      let lastMatch = matches[matches.length - 1];
      lastMatch = lastMatch
        .replace(/^●\s*/, '')
        .replace(/[─╭╰│┌┐└┘├┤┬┴┼]+/g, '')
        .replace(/\? for shortcuts/g, '')
        .replace(/esc to interrupt/g, '')
        .replace(/Churning…/g, '')
        .replace(/\(thinking\)/g, '')
        .trim();

      const lines = lastMatch.split('\n')
        .map(l => l.trim())
        .filter(l => {
          if (l.length === 0) return false;
          if (l.match(/^[\s─╭╰│┌┐└┘├┤┬┴┼✢✶✻✽·*]+$/)) return false;
          if (l.match(/Cascading|Churning|thinking|thought for/i)) return false;
          if (l.match(/^\d+s\)$/)) return false;
          return true;
        });

      return lines.join('\n').trim();
    }
    return '';
  }

  /**
   * Extract answer from Gemini output
   */
  private extractAnswerGemini(cleanOutput: string): string {
    const lines = cleanOutput.split('\n');
    let inResponse = false;
    const response: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip UI elements
      if (trimmed.match(/^[┃┏┓┗┛━─╭╮╯╰│]+$/) ||
          trimmed.match(/^Gemini/i) ||
          trimmed.match(/^Type .* to/i)) {
        continue;
      }
      if (trimmed.length > 0 && !trimmed.match(/^>/)) {
        response.push(trimmed);
      }
    }

    return response.join('\n').trim();
  }

  /**
   * Get raw output
   */
  getOutput(lines: number = 100): string {
    const allLines = this.output.split('\n');
    return allLines.slice(-lines).join('\n');
  }

  /**
   * Get full output
   */
  getFullOutput(): string {
    return this.output;
  }

  /**
   * Check if session is running
   */
  isRunning(): boolean {
    return this.process !== null && this.isReady;
  }

  /**
   * Check if session is ready
   */
  getIsReady(): boolean {
    return this.isReady;
  }

  /**
   * Get provider
   */
  getProvider(): CliProvider {
    return this.provider;
  }

  /**
   * Stop the session
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      this.once('exit', () => resolve());

      this.write(this.config.exitCommand);

      setTimeout(() => {
        if (this.process) {
          this.process.kill();
        }
        resolve();
      }, 3000);
    });
  }
}
