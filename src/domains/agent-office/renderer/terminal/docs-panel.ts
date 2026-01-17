import pc from 'picocolors';
import { PlanDocument, DocumentType } from '../../types.js';
import { groupDocumentsByType } from '../../documents-scanner.js';

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
 * Section titles
 */
const SECTION_TITLES: Record<DocumentType, string> = {
  plan: '\uD83D\uDCCB Main Plan',
  phase: '\uD83D\uDCD1 Phases',
  research: '\uD83D\uDD0D Research',
  artifact: '\uD83D\uDCE6 Artifacts',
  report: '\uD83D\uDCCA Reports',
  other: '\uD83D\uDCC4 Other',
};

/**
 * Render documents panel
 */
export function renderDocsPanel(
  documents: PlanDocument[],
  planName: string | null,
  selectedIndex: number,
  width: number,
  height: number
): string[] {
  const lines: string[] = [];
  const grouped = groupDocumentsByType(documents);

  // Header
  lines.push(BOX.topLeft + BOX.horizontal.repeat(width - 2) + BOX.topRight);
  const title = '\uD83D\uDCC1 DOCUMENTS';
  const closeHint = '[ESC] Close';
  const headerPadding = width - 4 - title.length - closeHint.length;
  lines.push(BOX.vertical + ' ' + title + ' '.repeat(Math.max(1, headerPadding)) + closeHint + ' ' + BOX.vertical);

  // Plan name
  const plan = planName ? `Plan: ${planName}` : 'No active plan';
  lines.push(BOX.vertical + ' ' + pc.dim(plan) + ' '.repeat(Math.max(0, width - 4 - plan.length)) + BOX.vertical);
  lines.push(BOX.vertical + BOX.horizontal.repeat(width - 2) + BOX.vertical);

  // Check if no plan
  if (!planName) {
    lines.push(BOX.vertical + ' '.repeat(width - 2) + BOX.vertical);
    const msg1 = 'No active plan set';
    lines.push(BOX.vertical + ' '.repeat(Math.floor((width - msg1.length) / 2)) + msg1 + ' '.repeat(Math.ceil((width - msg1.length) / 2) - 2) + BOX.vertical);
    lines.push(BOX.vertical + ' '.repeat(width - 2) + BOX.vertical);
    const msg2 = 'Run "gk plan create <name>" to create';
    lines.push(BOX.vertical + ' '.repeat(Math.floor((width - msg2.length) / 2)) + pc.dim(msg2) + ' '.repeat(Math.ceil((width - msg2.length) / 2) - 2) + BOX.vertical);
  } else {
    // Sections
    let flatIndex = 0;
    const order: DocumentType[] = ['plan', 'phase', 'report', 'research', 'artifact', 'other'];

    for (const type of order) {
      const docs = grouped[type];
      if (docs.length === 0) continue;

      // Section header
      const sectionTitle = SECTION_TITLES[type];
      lines.push(BOX.vertical + ' ' + pc.bold(sectionTitle) + ` (${docs.length})` + ' '.repeat(Math.max(0, width - 8 - sectionTitle.length - String(docs.length).length)) + BOX.vertical);
      lines.push(BOX.vertical + ' ' + BOX.horizontal.repeat(width - 4) + ' ' + BOX.vertical);

      // Items
      for (const doc of docs) {
        const isSelected = flatIndex === selectedIndex;
        const highlight = isSelected ? pc.inverse : (s: string) => s;
        const timeStr = formatRelativeTime(doc.modifiedAt);
        const recent = Date.now() - doc.modifiedAt < 3600000; // < 1 hour

        const itemLine = `\u25CB ${doc.icon} ${doc.displayName}`;
        const padding = width - 6 - itemLine.length - timeStr.length;
        const timeFn = recent ? pc.green : pc.dim;

        lines.push(BOX.vertical + highlight(' ' + itemLine + ' '.repeat(Math.max(1, padding)) + timeFn(timeStr) + ' ') + BOX.vertical);
        flatIndex++;
      }

      lines.push(BOX.vertical + ' '.repeat(width - 2) + BOX.vertical);
    }
  }

  // Padding
  const currentHeight = lines.length;
  const padding = height - currentHeight - 2;
  for (let i = 0; i < Math.max(0, padding); i++) {
    lines.push(BOX.vertical + ' '.repeat(width - 2) + BOX.vertical);
  }

  // Footer
  lines.push(BOX.vertical + BOX.horizontal.repeat(width - 2) + BOX.vertical);
  const controls = '[\u2191/\u2193] Navigate  [Enter] Open  [O] Open folder';
  const footerPad = width - 4 - controls.length;
  lines.push(BOX.vertical + ' ' + controls + ' '.repeat(Math.max(0, footerPad)) + ' ' + BOX.vertical);
  lines.push(BOX.bottomLeft + BOX.horizontal.repeat(width - 2) + BOX.bottomRight);

  return lines;
}
