/**
 * PTY Context Builder
 * Builds enriched prompt for first send in interactive mode
 * Uses @ file references for Gemini CLI native file loading
 * Keeps XML structure for AI to understand context
 */

import { existsSync } from 'fs';
import { join } from 'path';
import type { PtySessionState, LoadedContext } from './pty-types.js';
import type { CliProvider } from './types.js';

/**
 * Build enriched prompt for first send
 * Keeps XML structure but uses @ references for file content
 */
export function buildFirstSendPrompt(
  task: string,
  sessionState: PtySessionState
): string {
  const promptParts: string[] = [];
  const provider = sessionState.provider;

  // Add subagent context
  promptParts.push('<subagent-context>');
  promptParts.push(`Agent Type: Interactive Session`);
  promptParts.push(`Agent Role: ${sessionState.context.agentName || 'Assistant'}`);
  promptParts.push(`Project: ${process.cwd()}`);
  promptParts.push('</subagent-context>');
  promptParts.push('');

  // Add task
  promptParts.push('<task>');
  promptParts.push(task);
  promptParts.push('</task>');
  promptParts.push('');

  // Add agent section with @ file reference
  if (sessionState.context.agentName) {
    const agentPath = getAgentFilePath(sessionState.context.agentName, provider);
    if (agentPath) {
      promptParts.push('<agent>');
      promptParts.push(`Your role and responsibilities are defined in: @${agentPath}`);
      promptParts.push('</agent>');
      promptParts.push('');
    }
  }

  // Add skills section with @ file references
  if (sessionState.context.skills.length > 0) {
    promptParts.push('<skills>');
    promptParts.push('You have access to the following skills and capabilities:');
    for (const skill of sessionState.context.skills) {
      const skillPath = getSkillFilePath(skill, provider);
      if (skillPath) {
        promptParts.push(`- ${skill}: @${skillPath}`);
      }
    }
    promptParts.push('</skills>');
    promptParts.push('');
  }

  // Add context section with @ file references
  if (sessionState.context.contextFiles.length > 0) {
    promptParts.push('<context>');
    promptParts.push('The following documents provide additional context:');
    for (const ctx of sessionState.context.contextFiles) {
      if (ctx.path) {
        promptParts.push(`- ${ctx.name}: @${ctx.path}`);
      }
    }
    promptParts.push('</context>');
    promptParts.push('');
  }

  return promptParts.join('\n');
}

/**
 * Get agent file path based on provider
 * Checks file existence and returns the first valid path
 */
export function getAgentFilePath(agentName: string, provider: CliProvider): string | null {
  const cwd = process.cwd();
  // Try provider-specific path first, then fallback
  const paths = provider === 'claude'
    ? [`.claude/agents/${agentName}.md`, `.gemini/agents/${agentName}.md`]
    : [`.gemini/agents/${agentName}.md`, `.claude/agents/${agentName}.md`];

  for (const relPath of paths) {
    const fullPath = join(cwd, relPath);
    if (existsSync(fullPath)) {
      return relPath;
    }
  }

  // Return first path as fallback (for @ reference even if file doesn't exist yet)
  return paths[0];
}

/**
 * Get skill file path based on provider
 * Checks file existence and returns the first valid path
 */
export function getSkillFilePath(skillName: string, provider: CliProvider): string | null {
  const cwd = process.cwd();
  // Skills can be in extensions folder or skills folder
  const paths = provider === 'claude'
    ? [`.claude/skills/${skillName}.md`, `.gemini/skills/${skillName}/SKILL.md`, `.gemini/extensions/${skillName}/SKILL.md`]
    : [`.gemini/skills/${skillName}/SKILL.md`, `.gemini/extensions/${skillName}/SKILL.md`, `.claude/skills/${skillName}.md`];

  for (const relPath of paths) {
    const fullPath = join(cwd, relPath);
    if (existsSync(fullPath)) {
      return relPath;
    }
  }

  // Return first path as fallback
  return paths[0];
}
