import pc from 'picocolors';
import { OfficeState, OfficeAgent } from '../../types.js';
import {
  renderAgentDesk,
  renderOrchestratorDesk,
  renderNotificationBanner,
  renderFooter,
  horizontalLine,
} from './components.js';

const BOX = {
  topLeft: '\u250C',
  topRight: '\u2510',
  bottomLeft: '\u2514',
  bottomRight: '\u2518',
  horizontal: '\u2500',
  vertical: '\u2502',
};

export interface TerminalRendererOptions {
  width?: number;
  height?: number;
  refreshRate?: number;
}

export class TerminalRenderer {
  private width: number;
  private height: number;
  private state: OfficeState | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;
  private refreshRate: number;

  constructor(options: TerminalRendererOptions = {}) {
    this.width = options.width || process.stdout.columns || 80;
    this.height = options.height || process.stdout.rows || 24;
    this.refreshRate = options.refreshRate || 500;
  }

  /**
   * Update state and re-render
   */
  update(state: OfficeState): void {
    this.state = state;
    this.render();
  }

  /**
   * Start auto-refresh loop
   */
  startAutoRefresh(): void {
    if (this.refreshInterval) return;
    this.refreshInterval = setInterval(() => {
      if (this.state) this.render();
    }, this.refreshRate);
  }

  /**
   * Stop auto-refresh
   */
  stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Clear screen and move cursor to top
   */
  private clearScreen(): void {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  /**
   * Main render function
   */
  render(): void {
    if (!this.state) return;

    this.clearScreen();
    const lines: string[] = [];

    // Header
    lines.push(this.renderHeader());
    lines.push(BOX.topLeft + horizontalLine(this.width - 2) + BOX.topRight);

    // Notification banner
    if (this.state.currentNotification) {
      lines.push(BOX.vertical + renderNotificationBanner(
        this.state.currentNotification.message,
        this.state.currentNotification.type,
        this.width - 2
      ) + BOX.vertical);
    } else {
      lines.push(BOX.vertical + ' '.repeat(this.width - 2) + BOX.vertical);
    }

    lines.push(BOX.vertical + horizontalLine(this.width - 2, '\u2500') + BOX.vertical);

    // Office floor - orchestrator at top center
    if (this.state.orchestrator) {
      const orchLines = renderOrchestratorDesk(this.state.orchestrator, 30);
      const orchPadding = Math.floor((this.width - 32) / 2);
      for (const line of orchLines) {
        lines.push(BOX.vertical + ' '.repeat(orchPadding) + line + ' '.repeat(Math.max(0, this.width - 2 - orchPadding - 30)) + BOX.vertical);
      }
    }

    // Connection lines
    lines.push(BOX.vertical + ' '.repeat(this.width - 2) + BOX.vertical);

    // Sub-agents in grid
    const agents = Array.from(this.state.agents.values());
    const agentLines = this.renderAgentGrid(agents);
    for (const line of agentLines) {
      lines.push(BOX.vertical + line + BOX.vertical);
    }

    // Padding to fill screen
    const contentHeight = lines.length;
    const remainingHeight = this.height - contentHeight - 3; // -3 for footer
    for (let i = 0; i < remainingHeight; i++) {
      lines.push(BOX.vertical + ' '.repeat(this.width - 2) + BOX.vertical);
    }

    // Footer
    lines.push(BOX.vertical + horizontalLine(this.width - 2, '\u2500') + BOX.vertical);
    lines.push(renderFooter(
      this.state.inbox.length,
      this.state.documents.length,
      this.state.sessionId,
      { active: agents.filter(a => a.state === 'working').length, total: agents.length },
      this.width
    ));
    lines.push(BOX.bottomLeft + horizontalLine(this.width - 2) + BOX.bottomRight);

    // Output
    process.stdout.write(lines.join('\n') + '\n');
  }

  /**
   * Render header with title
   */
  private renderHeader(): string {
    const title = '\uD83C\uDFC6 AGENT OFFICE \uD83C\uDFC6';
    const padding = Math.floor((this.width - title.length) / 2);
    return ' '.repeat(Math.max(0, padding)) + pc.bold(pc.magenta(title));
  }

  /**
   * Render agents in a grid layout
   */
  private renderAgentGrid(agents: OfficeAgent[]): string[] {
    if (agents.length === 0) return [' '.repeat(this.width - 2)];

    const deskWidth = 24;
    const desksPerRow = Math.floor((this.width - 4) / (deskWidth + 2));
    const rows: string[][] = [];

    // Render each agent desk
    const renderedDesks = agents.map(a => renderAgentDesk(a, deskWidth));

    // Group into rows
    for (let i = 0; i < renderedDesks.length; i += desksPerRow) {
      const rowDesks = renderedDesks.slice(i, i + desksPerRow);
      rows.push(this.combineDesksHorizontally(rowDesks, deskWidth));
    }

    // Flatten rows
    return rows.flat();
  }

  /**
   * Combine multiple desk renders horizontally
   */
  private combineDesksHorizontally(desks: string[][], deskWidth: number): string[] {
    if (desks.length === 0) return [];

    const maxHeight = Math.max(...desks.map(d => d.length));
    const combined: string[] = [];

    for (let i = 0; i < maxHeight; i++) {
      let line = ' ';
      for (const desk of desks) {
        const deskLine = desk[i] || ' '.repeat(deskWidth);
        line += deskLine + '  ';
      }
      // Pad to width
      const padding = this.width - 2 - line.length;
      combined.push(line + ' '.repeat(Math.max(0, padding)));
    }

    return combined;
  }

  /**
   * Cleanup
   */
  dispose(): void {
    this.stopAutoRefresh();
  }
}
