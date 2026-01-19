/**
 * Model and tool mappings between Gemini and Claude CLIs
 */

import type { CliProvider } from './types.js';

// ============================================================================
// MODEL MAPPINGS
// ============================================================================

const GEMINI_TO_CLAUDE_MODEL: Record<string, string> = {
  'gemini-3-pro-preview': 'opus',
  'gemini-2.5-pro': 'opus',
  'gemini-3-flash-preview': 'sonnet',
  'gemini-2.5-flash': 'sonnet',
  'gemini-2.5-flash-lite': 'haiku',
};

const CLAUDE_TO_GEMINI_MODEL: Record<string, string> = {
  'opus': 'gemini-2.5-pro',
  'sonnet': 'gemini-2.5-flash',
  'haiku': 'gemini-2.5-flash-lite',
};

const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus'];

/**
 * Map model to target CLI provider
 */
export function mapModel(model: string, targetProvider: CliProvider): string {
  if (targetProvider === 'claude') {
    // Check if already a Claude model
    if (CLAUDE_MODELS.includes(model)) {
      return model;
    }
    return GEMINI_TO_CLAUDE_MODEL[model] || 'sonnet'; // default: sonnet
  } else {
    // Check if already a Gemini model
    if (model.startsWith('gemini-')) {
      return model;
    }
    return CLAUDE_TO_GEMINI_MODEL[model] || 'gemini-2.5-flash'; // default: gemini-2.5-flash
  }
}

// ============================================================================
// TOOL MAPPINGS
// ============================================================================

const GEMINI_TO_CLAUDE_TOOL: Record<string, string> = {
  'list_directory': 'Bash',
  'read_file': 'Read',
  'write_file': 'Write',
  'glob': 'Glob',
  'search_file_content': 'Grep',
  'replace': 'Edit',
  'run_shell_command': 'Bash',
  'web_fetch': 'WebFetch',
  'google_web_search': 'WebSearch',
  'save_memory': 'TodoWrite',
  'write_todos': 'TodoWrite',
};

const CLAUDE_TO_GEMINI_TOOL: Record<string, string> = {
  'Read': 'read_file',
  'Write': 'write_file',
  'Edit': 'replace',
  'Bash': 'run_shell_command',
  'Glob': 'glob',
  'Grep': 'search_file_content',
  'WebFetch': 'web_fetch',
  'WebSearch': 'google_web_search',
  'TodoWrite': 'write_todos',
  'Task': '', // No direct equivalent
};

/**
 * Check if a tool name is a Claude tool (PascalCase)
 */
function isClaudeTool(tool: string): boolean {
  return /^[A-Z]/.test(tool);
}

/**
 * Check if a tool name is a Gemini tool (snake_case or starts with gemini)
 */
function isGeminiTool(tool: string): boolean {
  return tool.includes('_') || tool.startsWith('gemini');
}

/**
 * Map a single tool to target CLI provider
 */
export function mapTool(tool: string, targetProvider: CliProvider): string {
  // Extract base tool and permission suffix
  // Gemini: run_shell_command(*) -> base: run_shell_command, suffix: (*)
  // Claude: Bash(git:*) -> base: Bash, suffix: (git:*)
  const match = tool.match(/^([^(]+)(\(.*\))?$/);
  const baseTool = match?.[1] || tool;
  const suffix = match?.[2] || '';

  if (targetProvider === 'claude') {
    // Already a Claude tool
    if (isClaudeTool(baseTool)) {
      return tool;
    }

    const mapped = GEMINI_TO_CLAUDE_TOOL[baseTool];
    if (!mapped) return tool; // Keep original if no mapping

    // For Gemini's run_shell_command(*), map to just Bash (Claude handles permissions differently)
    if (baseTool === 'run_shell_command' && suffix === '(*)') {
      return mapped; // Just 'Bash', no suffix
    }

    return mapped + suffix;
  } else {
    // Already a Gemini tool
    if (isGeminiTool(baseTool)) {
      return tool;
    }

    const mapped = CLAUDE_TO_GEMINI_TOOL[baseTool];
    if (!mapped) return tool; // Keep original if no mapping

    // For Claude's Bash, map to run_shell_command(*)
    if (baseTool === 'Bash' && !suffix) {
      return 'run_shell_command(*)';
    }

    return mapped + suffix;
  }
}

/**
 * Map array of tools to target CLI provider (deduplicated)
 */
export function mapTools(tools: string[], targetProvider: CliProvider): string[] {
  const mapped = tools
    .map(t => mapTool(t, targetProvider))
    .filter(Boolean);
  return [...new Set(mapped)]; // Deduplicate
}

// ============================================================================
// FOLDER PATHS
// ============================================================================

/**
 * Get agent directory paths with fallback
 * Claude: .claude/agents/ -> .gemini/agents/
 * Gemini: .gemini/agents/ -> .claude/agents/
 */
export function getAgentPaths(targetProvider: CliProvider): string[] {
  if (targetProvider === 'claude') {
    return ['.claude/agents', '.gemini/agents'];
  } else {
    return ['.gemini/agents', '.claude/agents'];
  }
}

/**
 * Get skills directory paths with fallback
 * Claude: .claude/skills/ -> .gemini/extensions/
 * Gemini: .gemini/extensions/ -> .claude/skills/
 */
export function getSkillPaths(targetProvider: CliProvider): string[] {
  if (targetProvider === 'claude') {
    return ['.claude/skills', '.gemini/extensions'];
  } else {
    return ['.gemini/extensions', '.claude/skills'];
  }
}

// ============================================================================
// DEFAULT MODELS
// ============================================================================

/**
 * Get default model for CLI provider
 */
export function getDefaultModel(provider: CliProvider): string {
  return provider === 'claude' ? 'sonnet' : 'gemini-2.5-flash';
}
