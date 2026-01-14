/**
 * Types for skill/extension conversion
 */

/**
 * Claude skill frontmatter
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  [key: string]: unknown;
}

/**
 * Gemini extension configuration
 */
export interface GeminiExtension {
  name: string;
  version: string;
  description: string;
  license: string;
  contextFileName: string[];
  author?: string;
  tools?: GeminiTool[];
}

/**
 * Gemini extension tool definition
 */
export interface GeminiTool {
  name: string;
  description: string;
  command: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Skill info for listing
 */
export interface SkillInfo {
  name: string;
  path: string;
  hasSkillMd: boolean;
  hasReferences: boolean;
  description?: string;
}

/**
 * Conversion result
 */
export interface ConversionResult {
  skill: string;
  success: boolean;
  created: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Conversion options
 */
export interface ConvertOptions {
  force?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

/**
 * Agent frontmatter
 */
export interface AgentFrontmatter {
  name: string;
  description: string;
  model?: string;
  skills?: string;
  [key: string]: unknown;
}

/**
 * Agent info for listing
 */
export interface AgentInfo {
  name: string;
  path: string;
  description?: string;
  model?: string;
  skills?: string;
}

/**
 * Model mapping for conversion (Claude -> Gemini)
 */
export const MODEL_MAPPING: Record<string, string> = {
  // Claude models to Gemini equivalents
  'claude-3-opus': 'gemini-2.5-pro',
  'claude-3-sonnet': 'gemini-2.5-flash',
  'claude-3-haiku': 'gemini-2.5-flash',
  'claude-3.5-sonnet': 'gemini-2.5-pro',
  'claude-3.5-haiku': 'gemini-2.5-flash',
  // Keep Gemini models as-is
  'gemini-2.5-pro': 'gemini-2.5-pro',
  'gemini-2.5-flash': 'gemini-2.5-flash',
  'gemini-3-flash-preview': 'gemini-3-flash-preview',
};
