/**
 * Token scanner - Reads Gemini session files for token usage
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { TokenUsage } from './pricing.js';
import { getGeminiProjectHash } from '../session/env.js';

interface GeminiMessage {
  id?: string;
  timestamp?: string;
  type?: string;
  model?: string;
  content?: string;
  tokens?: {
    input?: number;
    output?: number;
    cached?: number;
    thoughts?: number;
    tool?: number;
    total?: number;
  };
}

interface GeminiSessionFile {
  sessionId: string;
  projectHash?: string;
  startTime?: string;
  lastUpdated?: string;
  messages?: GeminiMessage[];
}

export interface SessionAnalysis {
  sessionId: string;
  startTime: string | null;
  lastUpdated: string | null;
  duration: { seconds: number; formatted: string } | null;
  model: string;
  modelsUsed: string[];
  messageCount: number;
  tokens: TokenUsage;
  averages: {
    outputPerMessage: number;
    thoughtsPerMessage: number;
    toolPerMessage: number;
  };
}

/**
 * Get token usage for current session only (MVP limitation)
 */
export async function getCurrentSessionTokens(): Promise<SessionAnalysis | null> {
  const projectHash = getGeminiProjectHash();

  if (!projectHash) {
    return null;
  }

  return getLatestSessionAnalysis(projectHash);
}

/**
 * Get full session analysis from latest Gemini session file
 */
export function getLatestSessionAnalysis(projectHash: string): SessionAnalysis | null {
  const chatsDir = join(homedir(), '.gemini', 'tmp', projectHash, 'chats');

  if (!existsSync(chatsDir)) {
    return null;
  }

  // Find latest session file
  const files = readdirSync(chatsDir)
    .filter(f => f.startsWith('session-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    return null;
  }

  try {
    const filePath = join(chatsDir, files[0]);
    return analyzeSessionFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Analyze a session file and extract all stats
 */
export function analyzeSessionFile(filePath: string): SessionAnalysis | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const session = JSON.parse(content) as GeminiSessionFile;

    if (!session.messages || session.messages.length === 0) {
      return null;
    }

    const modelsUsed = new Set<string>();
    let sumOutput = 0;
    let sumThoughts = 0;
    let sumTool = 0;
    let lastTokens: GeminiMessage['tokens'] = undefined;
    let messagesWithTokens = 0;

    for (const msg of session.messages) {
      if (msg.model) {
        modelsUsed.add(msg.model);
      }
      if (msg.tokens) {
        sumOutput += msg.tokens.output || 0;
        sumThoughts += msg.tokens.thoughts || 0;
        sumTool += msg.tokens.tool || 0;
        lastTokens = msg.tokens;
        messagesWithTokens++;
      }
    }

    if (!lastTokens || messagesWithTokens === 0) {
      return null;
    }

    // Get cumulative values from last message
    const finalTotal = lastTokens.total || 0;
    const finalCached = lastTokens.cached || 0;

    // Calculate actual input (derived from total - output - thoughts)
    let actualInput = finalTotal - sumOutput - sumThoughts;
    if (actualInput < 0) actualInput = 0;

    const tokens: TokenUsage = {
      input: actualInput,
      output: sumOutput,
      cached: finalCached,
      thoughts: sumThoughts,
      tool: sumTool,
      total: finalTotal
    };

    // Calculate duration
    let duration: { seconds: number; formatted: string } | null = null;
    if (session.startTime && session.lastUpdated) {
      try {
        const start = new Date(session.startTime);
        const end = new Date(session.lastUpdated);
        const seconds = Math.floor((end.getTime() - start.getTime()) / 1000);
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        duration = {
          seconds,
          formatted: `${mins}m ${secs}s`
        };
      } catch {
        // Ignore date parsing errors
      }
    }

    // Get primary model
    const models = Array.from(modelsUsed);
    const primaryModel = models[0] || 'unknown';

    return {
      sessionId: session.sessionId,
      startTime: session.startTime || null,
      lastUpdated: session.lastUpdated || null,
      duration,
      model: primaryModel,
      modelsUsed: models,
      messageCount: messagesWithTokens,
      tokens,
      averages: {
        outputPerMessage: messagesWithTokens > 0 ? Math.round(sumOutput / messagesWithTokens) : 0,
        thoughtsPerMessage: messagesWithTokens > 0 ? Math.round(sumThoughts / messagesWithTokens) : 0,
        toolPerMessage: messagesWithTokens > 0 ? Math.round(sumTool / messagesWithTokens) : 0
      }
    };
  } catch {
    return null;
  }
}

/**
 * Get token usage by session ID
 */
export function getAgentTokenUsage(sessionId: string, projectHash: string): TokenUsage | null {
  const chatsDir = join(homedir(), '.gemini', 'tmp', projectHash, 'chats');

  if (!existsSync(chatsDir)) {
    return null;
  }

  const files = readdirSync(chatsDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const filePath = join(chatsDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const session = JSON.parse(content) as GeminiSessionFile;

      if (session.sessionId === sessionId ||
          (session.sessionId && sessionId.startsWith(session.sessionId.substring(0, 8)))) {
        const analysis = analyzeSessionFile(filePath);
        return analysis?.tokens || null;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Legacy format function for backward compatibility
 */
export function formatTokenUsage(usage: TokenUsage): string {
  const lines = [
    `Input:    ${usage.input.toLocaleString()}`,
    `Output:   ${usage.output.toLocaleString()}`,
    `Cached:   ${usage.cached.toLocaleString()}`,
    `Thoughts: ${usage.thoughts.toLocaleString()}`,
    `Tool:     ${usage.tool.toLocaleString()}`,
    `Total:    ${usage.total.toLocaleString()}`,
  ];
  return lines.join('\n');
}