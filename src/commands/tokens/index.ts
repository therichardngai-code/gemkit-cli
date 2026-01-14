/**
 * Tokens command - Session token usage analysis
 * Matches token_stats.py --latest output format
 */

import type { CAC } from 'cac';
import { getCurrentSessionTokens, type SessionAnalysis } from '../../domains/tokens/scanner.js';
import { calculateCost, formatCost, formatTokens, type CostBreakdown } from '../../domains/tokens/pricing.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';

// Box drawing characters
const BOX = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  middleLeft: '├',
  middleRight: '┤',
};

function boxTop(width: number = 75): string {
  return brand.dim(`${BOX.topLeft}${BOX.horizontal.repeat(width - 2)}${BOX.topRight}`);
}

function boxBottom(width: number = 75): string {
  return brand.dim(`${BOX.bottomLeft}${BOX.horizontal.repeat(width - 2)}${BOX.bottomRight}`);
}

function boxLine(text: string, width: number = 75): string {
  // Strip ANSI codes for length calculation
  const visibleLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
  const padding = Math.max(0, width - 4 - visibleLen);
  return `${brand.dim(BOX.vertical)} ${text}${' '.repeat(padding)} ${brand.dim(BOX.vertical)}`;
}

function sectionHeader(text: string): string {
  return `\n${pc.bold(brand.geminiPurple(`## ${text}`))}`;
}

function padLeft(text: string, width: number): string {
  const visibleLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
  const padding = Math.max(0, width - visibleLen);
  return ' '.repeat(padding) + text;
}

function padRight(text: string, width: number): string {
  const visibleLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
  const padding = Math.max(0, width - visibleLen);
  return text + ' '.repeat(padding);
}

function gradientText(text: string): string {
  // Gradient from Gemini blue (#1a73e8) to purple (#8e24aa)
  const result: string[] = [];
  const length = text.length;
  for (let i = 0; i < length; i++) {
    const ratio = i / Math.max(length - 1, 1);
    const r = Math.round(26 + (142 - 26) * ratio);
    const g = Math.round(115 + (36 - 115) * ratio);
    const b = Math.round(232 + (170 - 232) * ratio);
    result.push(`\x1b[38;2;${r};${g};${b}m${text[i]}`);
  }
  return result.join('') + '\x1b[0m';
}

function displaySessionAnalysis(analysis: SessionAnalysis): void {
  const cost = calculateCost(analysis.tokens, analysis.model);

  // Header box
  console.log();
  console.log(boxTop(75));
  console.log(boxLine(`${gradientText('SESSION ANALYSIS')}  ${brand.dim('Cost:')} ${brand.warn(formatCost(cost.total))}`, 75));
  console.log(boxBottom(75));

  // Session info
  console.log(`\n  ${brand.dim('Session ID:')}   ${brand.accent(analysis.sessionId)}`);
  console.log(`  ${brand.dim('Start Time:')}   ${analysis.startTime || 'N/A'}`);
  console.log(`  ${brand.dim('Duration:')}     ${brand.accent(analysis.duration?.formatted || 'N/A')}`);
  console.log(`  ${brand.dim('Model:')}        ${brand.geminiBlue(analysis.modelsUsed.join(', '))}`);
  console.log(`  ${brand.dim('Messages:')}     ${brand.accent(String(analysis.messageCount))}`);

  // Token Breakdown
  console.log(sectionHeader('Token Breakdown'));
  console.log(`\n    ${padRight('Category', 10)} ${padLeft('Count', 14)}  ${padLeft('Formatted', 10)}`);
  console.log(`    ${brand.dim('─'.repeat(10))} ${brand.dim('─'.repeat(14))} ${brand.dim('─'.repeat(10))}`);

  const tokenKeys: (keyof typeof analysis.tokens)[] = ['input', 'output', 'cached', 'thoughts', 'tool'];
  for (const key of tokenKeys) {
    const value = analysis.tokens[key];
    const countCol = padLeft(brand.accent(value.toLocaleString()), 14);
    const fmtCol = padLeft(brand.accent(formatTokens(value)), 10);
    console.log(`    ${padRight(key, 10)} ${countCol}  ${fmtCol}`);
  }

  console.log(`    ${brand.dim('─'.repeat(10))} ${brand.dim('─'.repeat(14))} ${brand.dim('─'.repeat(10))}`);
  const totalCount = padLeft(brand.success(analysis.tokens.total.toLocaleString()), 14);
  const totalFmt = padLeft(brand.success(formatTokens(analysis.tokens.total)), 10);
  console.log(`    ${padRight(pc.bold('total'), 10)} ${totalCount}  ${totalFmt}`);

  // Estimated Cost
  console.log(sectionHeader('Estimated Cost'));
  console.log(`\n    ${padRight('Input', 12)} ${padLeft(brand.warn(formatCost(cost.input)), 12)}`);
  console.log(`    ${padRight('Output', 12)} ${padLeft(brand.warn(formatCost(cost.output)), 12)}`);
  console.log(`    ${padRight('Cached', 12)} ${padLeft(brand.warn(formatCost(cost.cached)), 12)}`);
  console.log(`    ${padRight('Thoughts', 12)} ${padLeft(brand.warn(formatCost(cost.thoughts)), 12)}`);
  console.log(`    ${brand.dim('─'.repeat(24))}`);
  console.log(`    ${padRight(pc.bold('TOTAL'), 12)} ${padLeft(pc.bold(brand.warn(formatCost(cost.total))), 12)}`);

  // Averages
  if (analysis.messageCount > 0) {
    console.log(sectionHeader('Averages'));
    const tokensPerMsg = Math.round(analysis.tokens.total / analysis.messageCount);
    const costPerMsg = cost.total / analysis.messageCount;
    console.log(`\n    ${brand.dim('Tokens/msg:')}  ${brand.accent(tokensPerMsg.toLocaleString())}`);
    console.log(`    ${brand.dim('Cost/msg:')}    ${brand.warn(formatCost(costPerMsg))}`);
  }

  console.log();
}

function displayJsonOutput(analysis: SessionAnalysis): void {
  const cost = calculateCost(analysis.tokens, analysis.model);
  console.log(JSON.stringify({
    sessionId: analysis.sessionId,
    startTime: analysis.startTime,
    duration: analysis.duration,
    model: analysis.model,
    modelsUsed: analysis.modelsUsed,
    messageCount: analysis.messageCount,
    tokens: analysis.tokens,
    averages: analysis.averages,
    cost: {
      input: cost.input,
      output: cost.output,
      cached: cost.cached,
      thoughts: cost.thoughts,
      total: cost.total
    }
  }, null, 2));
}

export function registerTokensCommand(cli: CAC): void {
  cli
    .command('tokens', 'Show token usage for current session')
    .alias('t')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const analysis = await getCurrentSessionTokens();

      if (!analysis) {
        if (options.json) {
          console.log(JSON.stringify({ found: false }, null, 2));
        } else {
          console.log();
          logger.info('No token usage found for current session.');
          console.log();
        }
        return;
      }

      if (options.json) {
        displayJsonOutput(analysis);
        return;
      }

      displaySessionAnalysis(analysis);
    });
}
