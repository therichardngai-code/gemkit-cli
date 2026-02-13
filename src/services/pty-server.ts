/**
 * PTY Server - Maintains AI session and accepts commands via TCP
 * Ported from claude-pty-wrapper/server.js
 *
 * Team Integration:
 * - Polls for team messages when GK_TEAM_ID env var is set
 * - Injects messages into AI session for processing
 */

import net from 'net';
import crypto from 'crypto';
import { AIPTY } from './aipty.js';
import type { CliProvider } from '../domains/agent/types.js';
import type {
  PtySessionState,
  PtyExchange,
  PtyPendingTool,
  PtyToolResult,
  PtyServerStatus,
  PtyCompleteResponse,
  PtyPendingResponse
} from '../domains/agent/pty-types.js';
import {
  getAgentFilePath,
  getSkillFilePath
} from '../domains/agent/pty-context.js';
import type { InboxMessage } from '../domains/team/types.js';
import { updateMemberStatus } from '../domains/team/writer.js';
import {
  getTaskList,
  writeApprovalRequest,
  createAgentRef,
  getPendingForAgent,
  updateInboxMessage
} from '../domains/team/index.js';
import { sanitizeProjectPath } from '../utils/paths.js';

const DEFAULT_PORT = 3377;
const DEFAULT_HOST = '127.0.0.1';
const STABILITY_THRESHOLD_MS = 2000;
const MESSAGE_POLL_INTERVAL_MS = 1000;

// Team context from environment variables
interface TeamContext {
  teamId: string;
  teamName: string;
  role: 'leader' | 'member';
  agentId: string;
  agentName: string;
  leaderPort: number;
  projectDir: string;
}

export interface PtyServerOptions {
  provider: CliProvider;
  model: string;
  tools: string[];
  sessionState: PtySessionState;
  port?: number;
  debug?: boolean;
}

export class PtyServer {
  private ai: AIPTY | null = null;
  private server: net.Server | null = null;
  private outputHistory: string = '';
  private lastPromptIndex: number = 0;
  private lastSentPrompt: string = '';
  private lastDataReceivedTime: number = 0;
  private currentExchangeId: string | null = null;
  private exchangeHistory: PtyExchange[] = [];
  private streamClients: net.Socket[] = [];
  private port: number;
  private debug: boolean;

  // Team integration
  private teamContext: TeamContext | null = null;
  private isPollingMessages: boolean = false;
  private lastApprovalRequestId: string | null = null;
  private lastApprovalToolDetail: string | null = null;

  public pid: number = 0;

  constructor(private options: PtyServerOptions) {
    this.port = options.port || DEFAULT_PORT;
    this.debug = options.debug || false;

    // Initialize team context from environment variables
    this.teamContext = this.loadTeamContext();
  }

  /**
   * Load team context from environment variables
   */
  private loadTeamContext(): TeamContext | null {
    const teamId = process.env.GK_TEAM_ID;
    if (!teamId) {
      return null;
    }

    return {
      teamId,
      teamName: process.env.GK_TEAM_NAME || 'unknown',
      role: (process.env.GK_TEAM_ROLE === 'leader' ? 'leader' : 'member') as 'leader' | 'member',
      agentId: process.env.GK_SUB_SESSION_ID || process.env.GK_PARENT_SESSION_ID || '',
      agentName: process.env.GK_AGENT_NAME || 'agent',
      leaderPort: parseInt(process.env.GK_TEAM_LEADER_PORT || '3377', 10),
      projectDir: sanitizeProjectPath(process.cwd())
    };
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    const { provider, model, tools, sessionState } = this.options;

    if (this.debug) {
      console.log(`[Server] Starting ${provider} with model: ${model}`);
    }

    this.ai = new AIPTY({
      provider,
      model,
      tools,
      debug: this.debug
    });

    this.ai.on('data', (data: string) => {
      this.outputHistory += data;
      this.lastDataReceivedTime = Date.now();

      // Emit events to stream clients
      if (this.streamClients.length > 0) {
        const events = this.parseOutputForEvents(data);
        for (const event of events) {
          this.emitStreamEvent(event);
        }
      }
    });

    this.ai.on('ready', () => {
      if (this.debug) {
        console.log(`[Server] ${provider} is ready`);
      }
    });

    this.ai.on('exit', (code: number) => {
      if (this.debug) {
        console.log(`[Server] ${provider} exited with code: ${code}`);
      }
      this.ai = null;
    });

    await this.ai.start();

    // Start TCP server
    await this.startTcpServer();

    // Start team message polling if in team context
    if (this.teamContext) {
      this.startTeamMessagePolling();
    }
  }

  /**
   * Start polling for team messages via central inbox
   */
  private startTeamMessagePolling(): void {
    if (!this.teamContext || this.isPollingMessages) {
      return;
    }

    const { projectDir, agentId, teamId, agentName } = this.teamContext;

    if (this.debug) {
      console.log(`[Server] Starting team message polling for ${agentName} (${agentId})`);
    }

    // Update member status to ready
    updateMemberStatus(projectDir, teamId, agentId, 'ready');

    this.isPollingMessages = true;

    // Poll central inbox for messages and check for pending tools
    this.startInboxPolling();
  }

  /**
   * Poll central inbox for messages and check for pending approval requests
   */
  private inboxPollingInterval: NodeJS.Timeout | null = null;

  private startInboxPolling(): void {
    if (!this.teamContext || this.inboxPollingInterval) {
      return;
    }

    const { projectDir, teamId, agentName } = this.teamContext;

    this.inboxPollingInterval = setInterval(() => {
      // Check for messages in central inbox
      const pendingMessages = getPendingForAgent(projectDir, teamId, agentName);

      for (const msg of pendingMessages) {
        // Only process message and broadcast types
        if (msg.type === 'message' || msg.type === 'broadcast') {
          this.injectInboxMessage(msg);

          // Mark as delivered in inbox
          updateInboxMessage(projectDir, teamId, msg.id, {
            status: 'delivered',
            deliveredAt: new Date().toISOString()
          });
        }
      }

      // Check for pending tool confirmations and write to inbox
      this.checkAndWriteApprovalRequest();
    }, MESSAGE_POLL_INTERVAL_MS);
  }

  private stopInboxPolling(): void {
    if (this.inboxPollingInterval) {
      clearInterval(this.inboxPollingInterval);
      this.inboxPollingInterval = null;
    }
  }

  /**
   * Check for pending tools and write approval request to central inbox
   */
  private checkAndWriteApprovalRequest(): void {
    if (!this.teamContext) {
      return;
    }

    const pending = this.detectPendingTools();

    if (pending.hasPending && pending.tools.length > 0) {
      const tool = pending.tools[0];
      const toolDetail = tool.command || tool.path || 'unknown';

      // Only write if this is a new pending tool (different from last)
      if (toolDetail !== this.lastApprovalToolDetail) {
        const { projectDir, teamId, agentId, agentName } = this.teamContext;

        const fromRef = createAgentRef(agentId, agentName, 'member');

        const inboxMsg = writeApprovalRequest(
          projectDir,
          teamId,
          fromRef,
          tool.type,
          toolDetail,
          this.port
        );

        this.lastApprovalRequestId = inboxMsg.id;
        this.lastApprovalToolDetail = toolDetail;

        if (this.debug) {
          console.log(`[Server] Wrote approval request to inbox: ${inboxMsg.id}`);
        }
      }
    } else {
      // No pending tools, reset tracking
      if (this.lastApprovalToolDetail !== null) {
        this.lastApprovalRequestId = null;
        this.lastApprovalToolDetail = null;
      }
    }
  }

  /**
   * Stop polling for team messages
   */
  private stopTeamMessagePolling(): void {
    if (!this.teamContext || !this.isPollingMessages) {
      return;
    }

    const { projectDir, agentId, teamId } = this.teamContext;

    if (this.debug) {
      console.log(`[Server] Stopping team message polling`);
    }

    this.stopInboxPolling();
    this.isPollingMessages = false;

    // Update member status to idle
    updateMemberStatus(projectDir, teamId, agentId, 'idle');
  }

  /**
   * Inject an inbox message into the AI session
   */
  private injectInboxMessage(message: InboxMessage): void {
    if (!this.ai || !this.ai.getIsReady()) {
      if (this.debug) {
        console.log(`[Server] Cannot inject message - AI not ready`);
      }
      return;
    }

    // Format the message for injection
    const formattedMessage = this.formatInboxMessageForInjection(message);

    if (this.debug) {
      console.log(`[Server] Injecting message from ${message.from.name}: ${message.summary}`);
    }

    // Update status to busy while processing
    if (this.teamContext) {
      updateMemberStatus(this.teamContext.projectDir, this.teamContext.teamId, this.teamContext.agentId, 'busy');
    }

    // Send the formatted message to the AI
    this.lastPromptIndex = this.outputHistory.length;
    this.lastSentPrompt = formattedMessage;
    this.currentExchangeId = crypto.randomUUID();
    this.lastDataReceivedTime = Date.now();

    this.ai.write(formattedMessage);
    setTimeout(() => this.ai?.write('\r'), 300);

    // Emit to stream clients
    this.emitStreamEvent({
      type: 'team_message_received',
      from: message.from.name,
      messageType: message.type,
      summary: message.summary
    });
  }

  /**
   * Format an inbox message for injection into the AI session
   */
  private formatInboxMessageForInjection(message: InboxMessage): string {
    const parts: string[] = [];

    // Team message first
    parts.push('<team-message>');
    parts.push(`From: ${message.from.name}`);
    parts.push(`Type: ${message.type}`);

    if (message.metadata?.requestId) {
      parts.push(`Request ID: ${message.metadata.requestId}`);
    }

    parts.push('');
    parts.push(message.content);
    parts.push('</team-message>');

    // Inject agent role context after message (so AI remembers who it is when processing)
    // This is auto-injected for ALL team members - no config needed from orchestrator
    if (this.teamContext) {
      const sessionState = this.options.sessionState;
      const provider = this.options.provider;
      const memberName = this.teamContext.agentName || 'agent';

      // Derive role: use profile name if available, otherwise extract from member name
      // e.g., "researcher-1" → "researcher", "planner" → "planner"
      const profileRole = sessionState?.context?.agentName;
      const derivedRole = profileRole || memberName.replace(/-\d+$/, '');

      parts.push('');
      parts.push('<agent-context>');
      parts.push(`You are: ${memberName}`);
      parts.push(`Role: ${derivedRole}`);
      parts.push(`Team: ${this.teamContext.teamName}`);

      // Add @ file reference to agent profile (so AI can reload full context)
      const agentPath = getAgentFilePath(derivedRole, provider);
      if (agentPath) {
        parts.push(`Profile: @${agentPath}`);
      }

      // Add @ file references to skills
      if (sessionState?.context?.skills && sessionState.context.skills.length > 0) {
        parts.push('Skills:');
        for (const skill of sessionState.context.skills) {
          const skillPath = getSkillFilePath(skill, provider);
          if (skillPath) {
            parts.push(`  - ${skill}: @${skillPath}`);
          }
        }
      }

      parts.push('</agent-context>');
    }

    // Add task list for context (so agent knows what's available)
    if (this.teamContext && (message.type === 'message' || message.type === 'broadcast')) {
      const taskList = getTaskList(this.teamContext.projectDir, this.teamContext.teamId);

      parts.push('');
      parts.push('<team-tasks>');

      // Available tasks (ready to claim)
      if (taskList.available.length > 0) {
        parts.push('Available (ready to claim):');
        for (const task of taskList.available) {
          parts.push(`  - ${task.taskId}: ${task.subject}`);
          if (task.description && task.description !== task.subject) {
            parts.push(`    Description: ${task.description.slice(0, 200)}`);
          }
        }
      }

      // In progress tasks
      if (taskList.inProgress.length > 0) {
        parts.push('In Progress:');
        for (const task of taskList.inProgress) {
          parts.push(`  - ${task.taskId}: ${task.subject} [${task.owner}]`);
        }
      }

      // Blocked tasks
      if (taskList.blocked.length > 0) {
        parts.push('Blocked:');
        for (const task of taskList.blocked) {
          parts.push(`  - ${task.taskId}: ${task.subject} (waiting on: ${task.blockedBy.join(', ')})`);
        }
      }

      // Completed tasks (just count)
      if (taskList.completed.length > 0) {
        parts.push(`Completed: ${taskList.completed.length} task(s)`);
      }

      parts.push('</team-tasks>');
    }

    // Add instructions based on message type
    switch (message.type) {
      case 'shutdown_request':
        parts.push('');
        parts.push('Instructions: You have received a shutdown request. If you have completed your current task, respond with SendMessage(type: "shutdown_response", approve: true). If you need more time, respond with approve: false and explain why.');
        break;

      case 'message':
      case 'broadcast':
        parts.push('');
        parts.push('<instructions>');
        parts.push('Process this message from your teammate. Use the task list above to understand the current state.');
        parts.push('');
        parts.push('SHELL COMMANDS:');
        parts.push('- Claim a task: gk team task-claim <taskId> --as ' + (this.teamContext?.agentName || 'agent'));
        parts.push('- Complete a task: gk team task-done <taskId>');
        parts.push('- Send message: gk team send <recipientName> "<message>"');
        parts.push('- List tasks: gk team tasks');
        parts.push('');
        parts.push('COMMUNICATION PROTOCOL:');
        parts.push('- You can send messages to any teammate (Main Agent or other sub-agents)');
        parts.push('- Request progress updates from upstream agents (tasks you depend on)');
        parts.push('- Provide progress updates to downstream agents (tasks blocked by yours)');
        parts.push('');
        parts.push('WHEN YOU COMPLETE A TASK:');
        parts.push('1. Run task-done command to mark it complete');
        parts.push('2. Send completion message to Main Agent (leader)');
        parts.push('3. Notify downstream agents who are blocked by your task');
        parts.push('   Example: "Task task-xxx completed. Results saved to plans/research.md. You can now proceed."');
        parts.push('</instructions>');
        break;

      case 'plan_approval_request':
        parts.push('');
        parts.push('Instructions: A teammate is requesting approval for their plan. Review it and respond with SendMessage(type: "plan_approval_response", approve: true/false).');
        break;
    }

    return parts.join('\n');
  }

  /**
   * Start TCP server for client commands
   */
  private startTcpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        let isStreamMode = false;

        socket.on('data', (data) => {
          const message = data.toString().trim();
          const [cmd, ...argParts] = message.split(' ');
          const args = argParts.join(' ');

          const response = this.handleCommand(cmd, args);

          // Handle stream mode
          if (response === '__STREAM_MODE__') {
            isStreamMode = true;
            this.streamClients.push(socket);
            socket.write(JSON.stringify({ type: 'stream_started' }) + '\n');
            return;
          }

          socket.write(response + '\n');
        });

        socket.on('error', () => {
          // Client disconnected, ignore
        });

        socket.on('close', () => {
          if (isStreamMode) {
            this.streamClients = this.streamClients.filter(c => c !== socket);
          }
        });
      });

      this.server.listen(this.port, DEFAULT_HOST, () => {
        if (this.debug) {
          console.log(`[Server] Listening on ${DEFAULT_HOST}:${this.port}`);
        }
        resolve();
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.port} is already in use`));
        } else {
          reject(err);
        }
      });
    });
  }

  /**
   * Handle client command
   */
  handleCommand(cmd: string, args: string): string {
    switch (cmd) {
      case 'status':
        return JSON.stringify(this.getStatus());

      case 'send':
        return this.handleSend(args);

      case 'read':
        const lines = parseInt(args) || 200;
        const allLines = this.outputHistory.split('\n');
        return allLines.slice(-lines).join('\n');

      case 'extract':
        return this.extractAnswer();

      case 'exchange':
        return JSON.stringify(this.getStructuredExchange());

      case 'pending':
        return JSON.stringify(this.detectPendingTools());

      case 'complete':
        return JSON.stringify(this.isComplete());

      case 'history':
        if (args === 'clear') {
          this.exchangeHistory = [];
          return JSON.stringify({ ok: true, message: 'History cleared' });
        }
        return JSON.stringify({
          provider: this.options.provider,
          count: this.exchangeHistory.length,
          exchanges: this.exchangeHistory
        });

      case 'stop':
        if (this.ai) {
          this.ai.stop().then(() => {
            process.exit(0);
          });
          return JSON.stringify({ ok: true, message: 'Stopping...' });
        }
        return JSON.stringify({ error: 'Not running' });

      case 'stream':
        return '__STREAM_MODE__';

      case 'team':
        return JSON.stringify(this.getTeamStatus());

      default:
        return JSON.stringify({ error: 'Unknown command: ' + cmd });
    }
  }

  /**
   * Handle send command
   */
  private handleSend(prompt: string): string {
    if (!this.ai || !this.ai.getIsReady()) {
      return JSON.stringify({ error: 'Not ready' });
    }

    this.lastPromptIndex = this.outputHistory.length;

    // Only update lastSentPrompt for actual prompts, not tool confirmations
    const isToolConfirmation = /^[123yn]$/i.test(prompt.trim());
    if (!isToolConfirmation) {
      this.lastSentPrompt = prompt;
      this.currentExchangeId = crypto.randomUUID();
    }

    this.lastDataReceivedTime = Date.now();
    this.ai.write(prompt);
    setTimeout(() => this.ai?.write('\r'), 300);

    return JSON.stringify({ ok: true, exchangeId: this.currentExchangeId });
  }

  /**
   * Get server status
   */
  private getStatus(): PtyServerStatus {
    return {
      running: this.ai !== null,
      ready: this.ai?.getIsReady() || false,
      provider: this.options.provider,
      outputLength: this.outputHistory.length
    };
  }

  /**
   * Clean ANSI codes from output
   */
  private cleanAnsi(output: string): string {
    return output
      .replace(/\x1b\[\?[0-9;]*[a-z]/gi, '')
      .replace(/\x1b\[1C/g, ' ')
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\r/g, '');
  }

  /**
   * Extract answer based on provider
   */
  extractAnswer(): string {
    if (this.options.provider === 'gemini') {
      return this.extractAnswerGemini();
    }
    return this.extractAnswerClaude();
  }

  /**
   * Extract answer from Claude output
   */
  private extractAnswerClaude(): string {
    const cleanOutput = this.cleanAnsi(this.outputHistory);

    const matches = cleanOutput.match(/●\s*([\s\S]*?)(?=❯|$)/g);

    if (matches && matches.length > 0) {
      let lastMatch = matches[matches.length - 1];

      lastMatch = lastMatch
        .replace(/^●\s*/, '')
        .replace(/[─╭╰│┌┐└┘├┤┬┴┼⎿⎾]+/g, '')
        .replace(/\? for shortcuts/g, '')
        .replace(/esc to interrupt/g, '')
        .replace(/\w+ing…/g, '')
        .replace(/\(thinking\)/g, '')
        .replace(/·\s*/g, '')
        .replace(/[✢✶✻✽*]/g, '')
        .replace(/Tip:\s*Use\s+\/\w+[^.]*\./gi, '')
        .trim();

      const lines = lastMatch.split('\n')
        .map(l => l.trim())
        .filter(l => {
          if (l.length === 0) return false;
          if (l.match(/^[\s─╭╰│┌┐└┘├┤┬┴┼⎿⎾✢✶✻✽·*]+$/)) return false;
          if (l.match(/thinking|thought for/i)) return false;
          if (l.match(/^\d+s\)$/)) return false;
          if (l.match(/^IDE disconnected$/)) return false;
          if (l.match(/^Tip:\s*Use\s+\/\w+/i)) return false;
          return true;
        });

      return lines.join('\n').trim();
    }

    return '';
  }

  /**
   * Extract answer from Gemini output
   */
  private extractAnswerGemini(): string {
    // Use lastPromptIndex to get content after the prompt was sent
    // This is more reliable than searching for the prompt text (which may be truncated/multiline)
    const recentOutput = this.outputHistory.slice(this.lastPromptIndex);
    let clean = this.cleanAnsi(recentOutput);

    // Find the LAST ✦ marker (most recent AI response)
    const lastStarIdx = clean.lastIndexOf('✦');
    if (lastStarIdx === -1) {
      return '';
    }

    let part = clean.slice(lastStarIdx + 1);

    // Stop at tool markers
    const toolMatch = part.match(/[✓⊶⊷x?]\s*(?:Shell|WriteFile|ReadFile|ReadFolder|GoogleSearch|Activate Skill)/i);
    if (toolMatch) {
      part = part.slice(0, toolMatch.index);
    }

    // Stop at spinner/status messages
    const spinnerMatch = part.match(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|\(esc to cancel/);
    if (spinnerMatch) {
      part = part.slice(0, spinnerMatch.index);
    }

    // Stop at file preview box
    const fileBoxMatch = part.match(/╭─|│\s*\d+\s*│|│\s*\d+\s+[*#\-\w]/);
    if (fileBoxMatch) {
      part = part.slice(0, fileBoxMatch.index);
    }

    // Stop at next user prompt
    const nextPromptMatch = part.match(/\n\s*>\s+(?!Type your message)[^\n]{10,}/);
    if (nextPromptMatch) {
      part = part.slice(0, nextPromptMatch.index);
    }

    let answer = part.trim();

    // Remove UI artifacts
    answer = answer
      .replace(/[█▀▄░▓▒│┃╭╮╯╰┌┐└┘├┤┬┴┼─━╱╲]+/g, '')
      .replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '')
      .replace(/\d+s\)/g, '')
      .replace(/\(esc to cancel[^)]*\)/g, '')
      .replace(/Action Required[^\n]*/gi, '')
      .replace(/Waiting for user confirmation[^\n]*/gi, '')
      .replace(/\d+\.\s*Allow[^\n]*/gi, '')
      .replace(/>\s+[^\n]+/g, '')
      .replace(/Type your message[^\n]*/gi, '');

    // Remove duplicate lines
    const lines = answer.split('\n');
    const uniqueLines: string[] = [];
    const seenLines = new Set<string>();
    for (const line of lines) {
      const normalized = line.trim();
      if (normalized.length === 0) {
        if (uniqueLines.length === 0 || uniqueLines[uniqueLines.length - 1].trim() !== '') {
          uniqueLines.push(line);
        }
      } else if (!seenLines.has(normalized)) {
        seenLines.add(normalized);
        uniqueLines.push(line);
      }
    }

    return uniqueLines.join('\n').trim();
  }

  /**
   * Detect pending tool confirmations
   */
  detectPendingTools(): PtyPendingResponse {
    const cleanOutput = this.cleanAnsi(this.outputHistory);
    const recentOutput = cleanOutput.slice(-8000);
    const pending: PtyPendingTool[] = [];

    // Check for waiting confirmation indicators
    const isWaiting = recentOutput.includes('Waiting for user confirmation') ||
                      recentOutput.includes('Action Required') ||
                      recentOutput.includes('Allow once') ||
                      recentOutput.includes('Allow for this session') ||
                      recentOutput.match(/●\s*1\.\s*Allow/) ||
                      recentOutput.match(/Apply this change\?/i);

    if (this.options.provider === 'gemini') {
      const pendingPatterns = [
        { regex: /\?\s*Shell\s+([^\n│\[]+)/gi, type: 'shell' as const, field: 'command' },
        { regex: /\?\s*WriteFile\s+(?:Writing to\s+)?([^\n│]+)/gi, type: 'write_file' as const, field: 'path' },
        { regex: /\?\s*ReadFile\s+(?:Reading\s+)?([^\n│]+)/gi, type: 'read_file' as const, field: 'path' },
        { regex: /\?\s*ReadFolder\s+([^\n│]+)/gi, type: 'read_folder' as const, field: 'path' },
      ];

      const seen = new Set<string>();
      for (const { regex, type, field } of pendingPatterns) {
        const matches = recentOutput.matchAll(regex);
        for (const match of matches) {
          const detail = this.cleanToolDetail(match[1]);
          const key = `${type}:${detail.slice(0, 30)}`;
          if (detail && !seen.has(key) && isWaiting) {
            seen.add(key);
            const tool: PtyPendingTool = {
              type,
              [field]: detail,
              waiting: true,
              options: ['1. Allow once', '2. Allow for this session', '3. No, suggest changes']
            };
            pending.push(tool);
          }
        }
      }

      // Check for "Apply this change?" pattern
      if (recentOutput.match(/Apply this change\?/i) && isWaiting) {
        pending.push({
          type: 'apply_change',
          waiting: true,
          options: ['1. Allow once', '2. Allow for this session', '3. No, suggest changes']
        });
      }

      // Action Required indicator
      const actionMatch = recentOutput.match(/Action Required\s*(\d+)\s*of\s*(\d+)/i);
      if (actionMatch) {
        pending.forEach(p => {
          p.actionRequired = { current: parseInt(actionMatch[1]), total: parseInt(actionMatch[2]) };
        });
      }
    }

    // Claude tool confirmation patterns
    if (this.options.provider === 'claude') {
      const runMatch = recentOutput.match(/Run\s+(.+?)\s*\?/i);
      if (runMatch && isWaiting) {
        pending.push({ type: 'shell', command: runMatch[1].trim(), waiting: true });
      }

      const writeMatch = recentOutput.match(/Write to\s+(.+?)\s*\?/i);
      if (writeMatch && isWaiting) {
        pending.push({ type: 'write_file', path: writeMatch[1].trim(), waiting: true });
      }

      const editMatch = recentOutput.match(/Edit\s+(.+?)\s*\?/i);
      if (editMatch && isWaiting) {
        pending.push({ type: 'edit_file', path: editMatch[1].trim(), waiting: true });
      }
    }

    return {
      hasPending: pending.length > 0 && !!isWaiting,
      tools: pending,
      hint: isWaiting ? 'Send "1" to allow once, "2" for session, "3" to suggest changes' : undefined
    };
  }

  /**
   * Clean tool detail string
   */
  private cleanToolDetail(detail: string): string {
    return detail
      .replace(/[│┃╭╮╯╰┌┐└┘├┤┬┴┼█▀▄░▓▒]+/g, '')
      .replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '')
      .replace(/\(esc to cancel[^)]*\)/g, '')
      .replace(/\d+s\)/g, '')
      .replace(/…\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract tool results from output
   */
  extractToolResults(): PtyToolResult[] {
    const results: PtyToolResult[] = [];
    const seen = new Set<string>();

    if (this.options.provider === 'gemini') {
      const clean = this.cleanAnsi(this.outputHistory);
      const promptPattern = `> ${this.lastSentPrompt}`;
      const promptIdx = clean.lastIndexOf(promptPattern);
      const searchArea = promptIdx !== -1 ? clean.slice(promptIdx) : clean.slice(-30000);

      const completedPatterns = [
        { regex: /✓\s*Shell\s+([^\n│]+)/gi, type: 'shell', status: 'completed' as const },
        { regex: /✓\s*WriteFile\s+(?:Writing to\s+)?([^\n│]+)/gi, type: 'write_file', status: 'completed' as const },
        { regex: /✓\s*ReadFile\s+(?:Reading\s+)?([^\n│]+)/gi, type: 'read_file', status: 'completed' as const },
        { regex: /✓\s*ReadFolder\s+([^\n│]+)/gi, type: 'read_folder', status: 'completed' as const },
        { regex: /✓\s*GoogleSearch\s+([^\n│]+)/gi, type: 'web_search', status: 'completed' as const },
        { regex: /x\s*Shell\s+([^\n│]+)/gi, type: 'shell', status: 'failed' as const },
        { regex: /x\s*WriteFile\s+([^\n│]+)/gi, type: 'write_file', status: 'failed' as const },
      ];

      for (const { regex, type, status } of completedPatterns) {
        const matches = searchArea.matchAll(regex);
        for (const match of matches) {
          const detail = this.cleanToolDetail(match[1]);
          const key = `${type}:${detail.slice(0, 50)}`;
          if (detail && !seen.has(key)) {
            seen.add(key);
            results.push({ type, detail, status });
          }
        }
      }
    }

    if (this.options.provider === 'claude') {
      const cleanOutput = this.cleanAnsi(this.outputHistory);
      const toolMatches = cleanOutput.matchAll(/Ran\s+(\w+):\s*([^\n]+)/g);
      for (const match of toolMatches) {
        const key = `${match[1]}:${match[2].slice(0, 50)}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ type: match[1], detail: match[2].trim(), status: 'completed' });
        }
      }
    }

    return results;
  }

  /**
   * Get structured exchange data
   */
  getStructuredExchange(): PtyExchange {
    const answer = this.extractAnswer();
    const pending = this.detectPendingTools();
    const toolResults = this.extractToolResults();

    if (!this.currentExchangeId) {
      this.currentExchangeId = crypto.randomUUID();
    }

    const exchange: PtyExchange = {
      id: this.currentExchangeId,
      timestamp: new Date().toISOString(),
      prompt: this.lastSentPrompt,
      answer,
      pending: pending.hasPending ? pending.tools : [],
      toolResults,
      status: pending.hasPending ? 'waiting_confirmation' : 'complete'
    };

    // Save to history when complete
    if (exchange.status === 'complete' && answer.trim()) {
      const existingIdx = this.exchangeHistory.findIndex(e => e.id === this.currentExchangeId);
      if (existingIdx >= 0) {
        this.exchangeHistory[existingIdx] = exchange;
      } else {
        this.exchangeHistory.push(exchange);
      }
      this.currentExchangeId = null;
    }

    return exchange;
  }

  /**
   * Check if response is complete
   */
  isComplete(): PtyCompleteResponse {
    const recentOutput = this.outputHistory.slice(this.lastPromptIndex);
    const cleanOutput = this.cleanAnsi(recentOutput);

    if (this.options.provider === 'claude') {
      const hasResponse = cleanOutput.includes('●');
      const lastResponseIdx = cleanOutput.lastIndexOf('●');
      const lastPromptIdx = cleanOutput.lastIndexOf('❯');
      if (hasResponse && lastPromptIdx > lastResponseIdx) {
        return { complete: true };
      }
      return { complete: false, reason: 'streaming' };
    } else if (this.options.provider === 'gemini') {
      const hasResponse = cleanOutput.includes('✦');
      if (!hasResponse) {
        return { complete: false, reason: 'no_response' };
      }

      // Check for pending tool confirmations
      const tail = cleanOutput.slice(-3000);
      const hasPendingText = tail.includes('Waiting for user confirmation') ||
                             tail.includes('Action Required') ||
                             (tail.includes('Allow once') && tail.includes('Allow for this session'));

      const hasPendingMarker = /\?\s*(Shell|WriteFile|ReadFile|ReadFolder)/i.test(tail);

      if (hasPendingText || hasPendingMarker) {
        return {
          complete: false,
          reason: 'pending_tool',
          hint: 'Tool confirmation required. Use "gk agent send 1" to approve.'
        };
      }

      // Check stability
      const now = Date.now();
      const timeSinceLastData = now - this.lastDataReceivedTime;

      if (timeSinceLastData < STABILITY_THRESHOLD_MS) {
        return { complete: false, reason: 'streaming' };
      }

      const lastStarIdx = cleanOutput.lastIndexOf('✦');
      const contentAfterStar = cleanOutput.slice(lastStarIdx + 1);
      const hasContent = contentAfterStar.trim().length > 50;

      if (hasContent) {
        return { complete: true };
      }
      return { complete: false, reason: 'waiting_content' };
    }

    return { complete: false, reason: 'unknown' };
  }

  /**
   * Parse output for stream events
   */
  private parseOutputForEvents(rawData: string): Array<{ type: string; [key: string]: any }> {
    const cleanData = this.cleanAnsi(rawData);
    const events: Array<{ type: string; [key: string]: any }> = [];

    // Tool confirmation request
    if (cleanData.match(/\?\s*(Shell|WriteFile|ReadFile|ReadFolder)/i)) {
      const match = cleanData.match(/\?\s*(Shell|WriteFile|ReadFile|ReadFolder)\s+([^\n\[]+)/i);
      events.push({
        type: 'tool_confirmation_required',
        tool: match ? match[1] : 'unknown',
        detail: match ? match[2].trim() : null
      });
    }

    // Tool completion
    const completionMatch = cleanData.match(/✓\s*(Shell|WriteFile|ReadFile|ReadFolder|GoogleSearch)\s+([^\n]+)/i);
    if (completionMatch) {
      events.push({
        type: 'tool_completed',
        tool: completionMatch[1],
        detail: completionMatch[2].trim()
      });
    }

    // Response marker
    if (cleanData.includes('✦') || cleanData.includes('●')) {
      events.push({ type: 'response_chunk' });
    }

    // Prompt ready
    if (cleanData.match(/[❯>]\s*$/) || cleanData.includes('Type your message')) {
      events.push({ type: 'prompt_ready' });
    }

    return events;
  }

  /**
   * Emit event to stream clients
   */
  private emitStreamEvent(event: { type: string; [key: string]: any }): void {
    const data = JSON.stringify(event) + '\n';
    for (const client of this.streamClients) {
      try {
        client.write(data);
      } catch {
        // Remove dead clients
      }
    }
    this.streamClients = this.streamClients.filter(c => !c.destroyed);
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    // Stop team message polling first
    this.stopTeamMessagePolling();

    // Update member status to shutdown
    if (this.teamContext) {
      updateMemberStatus(
        this.teamContext.projectDir,
        this.teamContext.teamId,
        this.teamContext.agentId,
        'shutdown'
      );
    }

    if (this.server) {
      this.server.close();
    }
    if (this.ai) {
      await this.ai.stop();
    }
  }

  /**
   * Get team context (for external access)
   */
  getTeamContext(): TeamContext | null {
    return this.teamContext;
  }

  /**
   * Check if server is in team mode
   */
  isInTeamMode(): boolean {
    return this.teamContext !== null;
  }

  /**
   * Get team status for command response
   */
  private getTeamStatus(): {
    inTeam: boolean;
    teamId?: string;
    teamName?: string;
    role?: string;
    agentName?: string;
    isPolling?: boolean;
  } {
    if (!this.teamContext) {
      return { inTeam: false };
    }

    return {
      inTeam: true,
      teamId: this.teamContext.teamId,
      teamName: this.teamContext.teamName,
      role: this.teamContext.role,
      agentName: this.teamContext.agentName,
      isPolling: this.isPollingMessages
    };
  }
}

/**
 * Start server as standalone process
 */
export async function startPtyServerProcess(options: PtyServerOptions): Promise<void> {
  const server = new PtyServer(options);
  await server.start();

  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });
}
