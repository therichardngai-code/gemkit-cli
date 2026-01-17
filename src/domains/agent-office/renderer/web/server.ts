import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { exec } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { OfficeState, OfficeEvent } from '../../types.js';
import { OfficeEventEmitter } from '../../event-emitter.js';
import { getIndexHtml } from './assets.js';

export interface WebServerOptions {
  port: number;
  host?: string;
  autoOpen?: boolean;
  emitter: OfficeEventEmitter;
}

export class OfficeWebServer {
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private options: WebServerOptions;
  private clients: Set<WebSocket> = new Set();

  constructor(options: WebServerOptions) {
    this.options = options;
  }

  /**
   * Start the server
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      let port = this.options.port;
      let attempts = 0;
      const maxAttempts = 10;

      const tryStart = () => {
        this.server = createServer((req, res) => this.handleRequest(req, res));

        this.server.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
            attempts++;
            port++;
            tryStart();
          } else {
            reject(err);
          }
        });

        this.server.listen(port, this.options.host || 'localhost', () => {
          // Setup WebSocket server
          this.wss = new WebSocketServer({ server: this.server! });
          this.setupWebSocket();

          // Subscribe to state changes
          this.options.emitter.onStateChange((state) => {
            this.broadcastState(state);
          });

          this.options.emitter.onEvent((event) => {
            this.broadcastEvent(event);
          });

          resolve(port);
        });
      };

      tryStart();
    });
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.wss) {
      for (const client of this.clients) {
        client.close();
      }
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.clients.clear();
  }

  /**
   * Handle HTTP requests
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '/';

    // API endpoints
    if (url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.serializeState(this.options.emitter.getState())));
      return;
    }

    if (url === '/api/history') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.options.emitter.getHistory()));
      return;
    }

    // Open document API
    if (url.startsWith('/api/open-doc')) {
      const urlObj = new URL(url, `http://${req.headers.host}`);
      const docPath = urlObj.searchParams.get('path');

      if (!docPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'No path provided' }));
        return;
      }

      // Path could be absolute or relative - try both
      let fullPath = docPath;
      if (!existsSync(fullPath)) {
        fullPath = resolve(process.cwd(), docPath);
      }

      if (!existsSync(fullPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: `File not found: ${docPath}` }));
        return;
      }

      // Detect IDE from multiple sources
      // Priority: EDITOR env var > session appName (if valid) > code (fallback)
      const editor = process.env.EDITOR || process.env.VISUAL;
      const state = this.options.emitter.getState();
      const sessionAppName = state.appName?.toLowerCase() || '';

      // Valid IDE commands whitelist
      const validIdes = ['code', 'cursor', 'windsurf', 'zed', 'vim', 'nvim', 'nano', 'subl', 'atom', 'idea', 'webstorm', 'notepad++', 'antigravity'];
      const isValidIde = validIdes.some(ide => sessionAppName.includes(ide));

      let command: string;

      if (editor) {
        // User explicitly set EDITOR env var - use that
        command = `"${editor}" "${fullPath}"`;
        console.log(`[Agent Office] Using IDE from EDITOR env: ${editor}`);
      } else if (sessionAppName && isValidIde) {
        // Use appName from session only if it's a valid IDE
        command = `${sessionAppName} "${fullPath}"`;
        console.log(`[Agent Office] Using IDE from session: ${sessionAppName}`);
      } else {
        // Fallback to VS Code
        command = `code "${fullPath}"`;
        console.log('[Agent Office] No IDE detected, defaulting to VS Code');
      }

      exec(command, (error) => {
        if (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: error.message }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        }
      });
      return;
    }

    // Serve embedded index.html for root path
    const urlPath = url.split('?')[0].split('#')[0];
    if (urlPath === '/' || urlPath === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getIndexHtml());
      return;
    }

    // All other paths return 404 (CSS/JS are inlined in HTML)
    res.writeHead(404);
    res.end('Not Found');
  }

  /**
   * Setup WebSocket handlers
   */
  private setupWebSocket(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      // Send current state immediately
      const state = this.options.emitter.getState();
      try {
        ws.send(JSON.stringify({ type: 'state', data: this.serializeState(state) }));
      } catch (e) {
        // Ignore send errors on initial connect
      }

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
          if (msg.type === 'replay') {
            const events = this.options.emitter.replay(msg.fromTimestamp);
            ws.send(JSON.stringify({ type: 'replay', data: events }));
          }
        } catch (e) {
          // Ignore invalid messages
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });
  }

  /**
   * Broadcast state to all clients
   */
  private broadcastState(state: OfficeState): void {
    const message = JSON.stringify({ type: 'state', data: this.serializeState(state) });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (e) {
          // Ignore send errors
        }
      }
    }
  }

  /**
   * Broadcast event to all clients
   */
  private broadcastEvent(event: OfficeEvent): void {
    const message = JSON.stringify({ type: 'event', data: event });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (e) {
          // Ignore send errors
        }
      }
    }
  }

  /**
   * Serialize state for JSON (convert Map to object)
   */
  private serializeState(state: OfficeState): object {
    return {
      ...state,
      agents: Object.fromEntries(state.agents),
    };
  }
}
