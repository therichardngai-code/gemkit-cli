/**
 * Brand colors and styling for GemKit CLI
 * Matches gemkit-cli theme
 */

import pc from 'picocolors';

/**
 * Converts a hex color string to an ANSI escape sequence for 24-bit truecolor.
 */
const hexToAnsi = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
};

/**
 * Wraps text in a 24-bit truecolor ANSI escape sequence.
 */
const wrap = (hex: string) => (text: string) => {
  if (!pc.isColorSupported) return text;
  return `${hexToAnsi(hex)}${text}\x1b[39m`;
};

export const brand = {
  // Brand colors
  primary: wrap('#4f46e5'),
  secondary: wrap('#9333ea'),
  accent: wrap('#06b6d4'),
  geminiBlue: wrap('#1a73e8'),
  geminiPurple: wrap('#8e24aa'),

  // Semantic colors
  success: (text: string) => pc.green(text),
  error: (text: string) => pc.red(text),
  warn: (text: string) => pc.yellow(text),
  info: (text: string) => pc.cyan(text),
  dim: (text: string) => pc.dim(text),
};

/**
 * UI helpers
 */
export const ui = {
  // Horizontal lines
  line: (width = 60) => '─'.repeat(width),
  doubleLine: (width = 60) => '═'.repeat(width),

  // Status icons
  statusIcon: (status: string): string => {
    switch (status) {
      case 'active': return brand.success('●');
      case 'completed': return brand.dim('○');
      case 'failed': return brand.error('✗');
      default: return '?';
    }
  },

  // Check icons
  checkIcon: (passed: boolean, optional = false): string => {
    if (passed) return brand.success('✓');
    return optional ? brand.warn('○') : brand.error('✗');
  },

  // Header
  header: (text: string) => pc.bold(brand.geminiPurple(text)),

  // Section with lines
  section: (title: string, width = 60) => {
    console.log();
    console.log('─'.repeat(width));
    console.log(pc.bold(brand.geminiPurple(title)));
    console.log('─'.repeat(width));
    console.log();
  },
};

/**
 * Prints the GemKit CLI banner.
 */
export function printBanner() {
  console.log();
  console.log(pc.bold(brand.geminiPurple('  ┌─────────────────────────────┐')));
  console.log(
    pc.bold(brand.geminiPurple('  │')) +
      '  ' +
      pc.bold(brand.primary('GK')) +
      ' ' +
      pc.white('GemKit CLI MVP') +
      '       ' +
      pc.bold(brand.geminiPurple('│'))
  );
  console.log(pc.bold(brand.geminiPurple('  └─────────────────────────────┘')));
  console.log();
}

// Legacy compatibility - map old colors to new brand
export const colors = {
  success: brand.success,
  error: brand.error,
  warning: brand.warn,
  info: brand.info,
  dim: brand.dim,
  primary: brand.primary,
  secondary: brand.secondary,
  bold: pc.bold,
};

// Re-export picocolors
export { pc };
