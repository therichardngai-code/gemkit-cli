/**
 * Icon mapping utilities for Agent Office
 */

// Icon mapping by role keywords
const ROLE_ICONS: [RegExp, string][] = [
  [/research|search|analyze/i, '\uD83D\uDD0D'],  // magnifier
  [/code|implement|execute|develop/i, '\uD83D\uDCBB'],  // laptop
  [/plan|architect/i, '\uD83D\uDCCB'],  // clipboard
  [/debug|fix|troubleshoot/i, '\uD83D\uDC1B'],  // bug
  [/test|qa|quality/i, '\uD83E\uDDEA'],  // test tube
  [/design|ui|ux/i, '\uD83C\uDFA8'],  // palette
  [/review|audit|check/i, '\u2705'],  // checkmark
  [/doc|write|content/i, '\uD83D\uDCDD'],  // memo
];

const DEFAULT_ICON = '\uD83E\uDD16';  // robot
const ORCHESTRATOR_ICON = '\uD83D\uDC51';  // crown

/**
 * Get icon for agent role
 */
export function getIconForRole(role: string, isOrchestrator = false): string {
  if (isOrchestrator) return ORCHESTRATOR_ICON;

  for (const [pattern, icon] of ROLE_ICONS) {
    if (pattern.test(role)) return icon;
  }

  return DEFAULT_ICON;
}

/**
 * Format role name for display
 */
export function formatDisplayName(role: string): string {
  return role
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
