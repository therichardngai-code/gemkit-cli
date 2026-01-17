import pc from 'picocolors';
import { OfficeAgent, OrchestratorAgent, AgentState } from '../../types.js';
import { formatDisplayName } from '../../icons.js';

// Box drawing characters
const BOX = {
  topLeft: '\u250C',
  topRight: '\u2510',
  bottomLeft: '\u2514',
  bottomRight: '\u2518',
  horizontal: '\u2500',
  vertical: '\u2502',
  doubleHorizontal: '\u2550',
  doubleVertical: '\u2551',
};

// State colors
const STATE_COLORS: Record<AgentState, (s: string) => string> = {
  idle: pc.gray,
  working: pc.green,
  walking: pc.blue,
  delivering: pc.yellow,
  receiving: pc.cyan,
};

/**
 * Create horizontal line
 */
export function horizontalLine(width: number, char = BOX.horizontal): string {
  return char.repeat(width);
}

/**
 * Create progress bar
 */
export function progressBar(progress: number, width = 12): string {
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;
  const bar = pc.cyan('\u2588'.repeat(filled)) + pc.gray('\u2591'.repeat(empty));
  return `[${bar}] ${progress}%`;
}

/**
 * Render single agent desk
 */
export function renderAgentDesk(agent: OfficeAgent, width = 22): string[] {
  const lines: string[] = [];
  const name = formatDisplayName(agent.role).slice(0, width - 4);
  const icon = agent.icon;
  const state = agent.state;
  const fireIcon = agent.hasFireEffect ? ' \uD83D\uDD25' : '';

  // Top border
  lines.push(BOX.topLeft + horizontalLine(width - 2) + BOX.topRight);

  // Title line
  const title = `${icon} ${name.toUpperCase()}`;
  const padding = width - 2 - title.length;
  lines.push(BOX.vertical + ' ' + title + ' '.repeat(Math.max(0, padding - 1)) + BOX.vertical);

  // Desk surface
  lines.push(BOX.vertical + '   ' + horizontalLine(width - 8) + '   ' + BOX.vertical);
  lines.push(BOX.vertical + '   ' + BOX.vertical + ' \uD83D\uDCBB  ' + BOX.vertical + '   ' + BOX.vertical);
  lines.push(BOX.vertical + '   ' + horizontalLine(width - 8) + '   ' + BOX.vertical);

  // Status line
  const statusText = STATE_COLORS[state](state) + fireIcon;
  const statusPadding = width - 2 - state.length - (agent.hasFireEffect ? 2 : 0) - 1;
  lines.push(BOX.vertical + ' ' + statusText + ' '.repeat(Math.max(0, statusPadding)) + BOX.vertical);

  // Progress bar (if working)
  if (state === 'working') {
    const bar = progressBar(agent.progress, width - 6);
    lines.push(BOX.vertical + ' ' + bar + ' ' + BOX.vertical);
  } else {
    lines.push(BOX.vertical + ' '.repeat(width - 2) + BOX.vertical);
  }

  // Bottom border
  lines.push(BOX.bottomLeft + horizontalLine(width - 2) + BOX.bottomRight);

  return lines;
}

/**
 * Render orchestrator desk (larger, centered)
 */
export function renderOrchestratorDesk(orch: OrchestratorAgent, width = 30): string[] {
  const lines: string[] = [];
  const crown = '\uD83D\uDC51';
  const title = 'ORCHESTRATOR';
  const fireIcon = orch.hasFireEffect ? ' \uD83D\uDD25' : '';

  // Top border (double line)
  lines.push(BOX.topLeft + BOX.doubleHorizontal.repeat(width - 2) + BOX.topRight);

  // Title
  const titlePadding = Math.floor((width - 2 - title.length - 4) / 2);
  lines.push(BOX.vertical + ' '.repeat(titlePadding) + crown + ' ' + title + ' ' + crown + ' '.repeat(titlePadding) + BOX.vertical);

  // Desk surface
  lines.push(BOX.vertical + '     ' + horizontalLine(width - 12) + '     ' + BOX.vertical);
  lines.push(BOX.vertical + '     ' + BOX.vertical + ' \uD83D\uDCCB \uD83C\uDFAF \u2713 ' + BOX.vertical + '     ' + BOX.vertical);
  lines.push(BOX.vertical + '     ' + horizontalLine(width - 12) + '     ' + BOX.vertical);

  // Status
  const status = STATE_COLORS[orch.state](orch.state) + fireIcon;
  lines.push(BOX.vertical + '    ' + orch.icon + ' ' + status + ' '.repeat(Math.max(0, width - 12 - orch.state.length)) + BOX.vertical);

  // Speech bubble
  if (orch.speechBubble) {
    const bubble = orch.speechBubble.slice(0, width - 6);
    lines.push(BOX.vertical + '  "' + bubble + '"' + ' '.repeat(Math.max(0, width - 6 - bubble.length)) + BOX.vertical);
  } else {
    lines.push(BOX.vertical + ' '.repeat(width - 2) + BOX.vertical);
  }

  // Sub-agent count
  const subInfo = `Sub-agents: ${orch.completedSubAgents}/${orch.totalSubAgents}`;
  lines.push(BOX.vertical + ' ' + subInfo + ' '.repeat(Math.max(0, width - 3 - subInfo.length)) + BOX.vertical);

  // Bottom border
  lines.push(BOX.bottomLeft + BOX.doubleHorizontal.repeat(width - 2) + BOX.bottomRight);

  return lines;
}

/**
 * Render notification banner
 */
export function renderNotificationBanner(message: string, type: string, width: number): string {
  const colors: Record<string, (s: string) => string> = {
    skill: pc.magenta,
    handoff: pc.green,
    success: pc.green,
    info: pc.cyan,
  };
  const colorFn = colors[type] || pc.white;
  const text = `[ ${message} ]`;
  const padding = Math.floor((width - text.length) / 2);
  return ' '.repeat(Math.max(0, padding)) + colorFn(text);
}

/**
 * Render footer status bar
 */
export function renderFooter(
  inboxCount: number,
  docsCount: number,
  sessionId: string | null,
  agentCount: { active: number; total: number },
  width: number
): string {
  const inbox = `\uD83D\uDCEC Inbox: ${inboxCount}`;
  const docs = `\uD83D\uDCC1 Docs: ${docsCount}`;
  const session = sessionId ? `Session: ${sessionId.slice(0, 8)}...` : 'No session';
  const agents = `Agents: ${agentCount.active}/${agentCount.total}`;
  const controls = '[Q]uit [I]nbox [D]ocs';

  const content = `${inbox}    ${docs}    ${session}    ${agents}    ${controls}`;
  const padding = width - content.length - 4;
  return BOX.vertical + ' ' + content + ' '.repeat(Math.max(0, padding)) + ' ' + BOX.vertical;
}
