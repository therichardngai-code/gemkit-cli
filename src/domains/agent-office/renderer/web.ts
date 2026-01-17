import { exec } from 'child_process';
import { join } from 'path';
import { OfficeEventEmitter } from '../event-emitter.js';
import { SessionFileWatcher } from '../file-watcher.js';
import { sessionToOfficeState } from '../session-bridge.js';
import { scanPlanDocuments } from '../documents-scanner.js';
import { OfficeWebServer } from './web/server.js';
import { createInitialState } from '../state-machine.js';
import { getPlansDir } from '../../../utils/paths.js';
export interface WebDashboardOptions {
  port?: number;
  host?: string;
  autoOpen?: boolean;
  onReady?: (port: number) => void;
  onError?: (error: Error) => void;
}

export class WebDashboard {
  private server: OfficeWebServer | null = null;
  private emitter: OfficeEventEmitter;
  private watcher: SessionFileWatcher;
  private options: WebDashboardOptions;

  constructor(options: WebDashboardOptions = {}) {
    this.options = {
      port: 3847,
      host: 'localhost',
      autoOpen: true,
      ...options,
    };

    // Initialize event emitter
    this.emitter = new OfficeEventEmitter(createInitialState());

    // Initialize file watcher
    this.watcher = new SessionFileWatcher({
      onSessionChange: (session) => {
        const state = sessionToOfficeState(session);

        // Scan documents if plan set
        if (state.activePlan) {
          try {
            const plansDir = getPlansDir();
            const planPath = join(plansDir, state.activePlan);
            state.documents = scanPlanDocuments(planPath);
          } catch (e) {
            // Ignore doc scan errors
          }
        }

        this.emitter.setState(state);
      },
      onEvent: (event) => {
        this.emitter.emit(event);
      },
      onError: (error) => {
        if (this.options.onError) {
          this.options.onError(error);
        }
      },
    });
  }

  /**
   * Start the web dashboard
   */
  async start(): Promise<number> {
    // Start file watcher
    const watcherStarted = this.watcher.start();
    if (!watcherStarted) {
      throw new Error('No active session found');
    }

    // Create and start server
    this.server = new OfficeWebServer({
      port: this.options.port!,
      host: this.options.host,
      emitter: this.emitter,
    });

    const actualPort = await this.server.start();

    // Auto-open browser
    if (this.options.autoOpen) {
      this.openBrowser(`http://${this.options.host}:${actualPort}`);
    }

    if (this.options.onReady) {
      this.options.onReady(actualPort);
    }

    return actualPort;
  }

  /**
   * Stop the dashboard
   */
  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
    this.watcher.stop();
    this.emitter.dispose();
  }

  /**
   * Open browser to URL
   */
  private openBrowser(url: string): void {
    const command = process.platform === 'win32'
      ? `start ${url}`
      : process.platform === 'darwin'
        ? `open ${url}`
        : `xdg-open ${url}`;

    exec(command, (error) => {
      if (error) {
        // Log to console if browser opening fails
        console.log(`Open ${url} in your browser`);
      }
    });
  }
}

/**
 * Start web dashboard (convenience function)
 */
export async function startWebDashboard(options: WebDashboardOptions = {}): Promise<WebDashboard> {
  const dashboard = new WebDashboard(options);
  await dashboard.start();
  return dashboard;
}