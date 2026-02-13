/**
 * PTY Provider Configurations
 * Claude Code and Gemini CLI specific settings
 */

import type { PtyProviderConfig } from './pty-types.js';
import type { CliProvider } from './types.js';

/**
 * Provider-specific configurations for PTY management
 */
export const PTY_PROVIDERS: Record<CliProvider, PtyProviderConfig> = {
  claude: {
    name: 'Claude Code',
    command: 'claude',
    package: '@anthropic-ai/claude-code',
    modelFlag: '--model',
    toolsFlag: '--allowedTools',
    toolsFormat: 'csv',           // Claude: --allowedTools Read,Write,Bash
    pipeFlag: undefined,          // No -p for interactive mode (use PTY)
    readyIndicator: '❯',          // Claude prompt indicator
    responseMarker: '●',          // Claude response marker
    exitCommand: '/exit\r'
  },
  gemini: {
    name: 'Gemini CLI',
    command: 'gemini',
    package: '@google/gemini-cli',
    modelFlag: '-m',
    toolsFlag: '--allowed-tools',
    toolsFormat: 'json',          // Gemini: --allowed-tools ["read_file","write_file"]
    pipeFlag: undefined,          // Gemini doesn't need -p
    readyIndicator: '>',          // Gemini prompt indicator
    responseMarker: '✦',          // Gemini response marker
    exitCommand: '/exit\r'
  }
};

/**
 * Get provider config by name
 */
export function getProviderConfig(provider: CliProvider): PtyProviderConfig {
  const config = PTY_PROVIDERS[provider];
  if (!config) {
    throw new Error(`Unknown provider: ${provider}. Use 'claude' or 'gemini'`);
  }
  return config;
}

/**
 * Build CLI arguments for starting a PTY session
 */
export function buildPtyArgs(
  provider: CliProvider,
  model: string,
  tools: string[]
): string[] {
  const config = PTY_PROVIDERS[provider];
  const args: string[] = [];

  // Add pipe flag if needed (Claude)
  if (config.pipeFlag) {
    args.push(config.pipeFlag);
  }

  // Add model flag
  args.push(config.modelFlag, model);

  // Add tools if any
  if (tools.length > 0) {
    if (config.toolsFormat === 'json') {
      // Gemini: --allowed-tools ["tool1","tool2"]
      args.push(config.toolsFlag, JSON.stringify(tools));
    } else {
      // Claude: --allowedTools tool1,tool2
      args.push(config.toolsFlag, tools.join(','));
    }
  }

  return args;
}
