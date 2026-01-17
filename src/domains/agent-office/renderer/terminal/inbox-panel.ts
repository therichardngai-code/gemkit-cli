import pc from 'picocolors';
import { InboxItem } from '../../types.js';

const BOX = {
  topLeft: '\u250C',
  topRight: '\u2510',
  bottomLeft: '\u2514',
  bottomRight: '\u2518',
  horizontal: '\u2500',
  vertical: '\u2502',
};

/**
 * Format relative time
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Format duration in human readable
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Render inbox panel
 */
export function renderInboxPanel(
  items: InboxItem[],
  selectedIndex: number,
  width: number,
  height: number
): string[] {
  const lines: string[] = [];
  const unreadCount = items.filter(i => i.status === 'unread').length;

  // Header
  lines.push(BOX.topLeft + BOX.horizontal.repeat(width - 2) + BOX.topRight);
  const title = `\uD83D\uDCEC INBOX (${items.length} messages, ${unreadCount} unread)`;
  const closeHint = '[ESC] Close';
  const headerPadding = width - 4 - title.length - closeHint.length;
  lines.push(BOX.vertical + ' ' + title + ' '.repeat(Math.max(1, headerPadding)) + closeHint + ' ' + BOX.vertical);
  lines.push(BOX.vertical + BOX.horizontal.repeat(width - 2) + BOX.vertical);

  // Items
  const maxItems = Math.floor((height - 6) / 5); // Each item takes roughly 5 lines
  const visibleItems = items.slice(0, maxItems);

  for (let i = 0; i < visibleItems.length; i++) {
    const item = visibleItems[i];
    const isSelected = i === selectedIndex;
    const indicator = item.status === 'unread' ? '\u25CF' : '\u25CB';
    const highlight = isSelected ? pc.inverse : (s: string) => s;

    // Item header
    const timeStr = formatRelativeTime(item.timestamp);
    const itemHeader = `${indicator} ${item.agentIcon} ${item.agentRole}`;
    const headerPad = width - 4 - itemHeader.length - timeStr.length;
    lines.push(BOX.vertical + highlight(' ' + itemHeader + ' '.repeat(Math.max(1, headerPad)) + timeStr + ' ') + BOX.vertical);

    // Title
    lines.push(BOX.vertical + highlight('   ' + item.title.slice(0, width - 8) + ' '.repeat(Math.max(0, width - 8 - item.title.length))) + BOX.vertical);

    // Preview
    const preview = item.preview.slice(0, width - 8);
    lines.push(BOX.vertical + highlight('   ' + pc.dim(preview) + ' '.repeat(Math.max(0, width - 8 - preview.length))) + BOX.vertical);

    // Meta
    const duration = `\u23F1\uFE0F ${formatDuration(item.duration)}`;
    const tokens = item.tokenUsage ? `\uD83D\uDCCA ${item.tokenUsage.input + item.tokenUsage.output} tok` : '';
    const meta = `   ${duration}  ${tokens}`;
    lines.push(BOX.vertical + highlight(meta + ' '.repeat(Math.max(0, width - 4 - meta.length))) + BOX.vertical);

    // Separator
    if (i < visibleItems.length - 1) {
      lines.push(BOX.vertical + ' '.repeat(width - 2) + BOX.vertical);
    }
  }

  // Padding
  const currentHeight = lines.length;
  const padding = height - currentHeight - 2;
  for (let i = 0; i < padding; i++) {
    lines.push(BOX.vertical + ' '.repeat(width - 2) + BOX.vertical);
  }

  // Footer
  lines.push(BOX.vertical + BOX.horizontal.repeat(width - 2) + BOX.vertical);
  const controls = '[\u2191/\u2193] Navigate  [Enter] View  [M] Mark read  [C] Clear';
  const footerPad = width - 4 - controls.length;
  lines.push(BOX.vertical + ' ' + controls + ' '.repeat(Math.max(0, footerPad)) + ' ' + BOX.vertical);
  lines.push(BOX.bottomLeft + BOX.horizontal.repeat(width - 2) + BOX.bottomRight);

  return lines;
}
