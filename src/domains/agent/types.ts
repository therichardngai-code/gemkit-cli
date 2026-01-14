/**
 * Agent type definitions for MVP
 * Aligned with Python core.py types
 */

// Intent types for agent selection
export type Intent =
  | 'research'
  | 'plan'
  | 'execute'
  | 'debug'
  | 'review'
  | 'test'
  | 'design'
  | 'docs'
  | 'git'
  | 'manage';

// Domain types for skill selection
export type Domain =
  | 'frontend'
  | 'backend'
  | 'auth'
  | 'payment'
  | 'database'
  | 'mobile'
  | 'fullstack'
  | 'ecommerce'
  | 'media'
  | 'ai'
  | 'quality'
  | 'codebase'
  | 'general';

// Complexity levels for skill count
export type Complexity = 'simple' | 'standard' | 'full' | 'complex';

export interface AgentProfile {
  name: string;
  description: string;
  model: string;
  skills?: string[];
  content: string;
  filePath: string;
}

export interface SpawnOptions {
  prompt: string;
  agent?: string;
  skills?: string;
  context?: string;
  model?: string;
}

export interface SpawnResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode: number;
  prompt?: string;
  agentRole?: string;
}

export interface SearchResult {
  agent: string;
  skills: string[];
  intent: Intent;
  domain: Domain;
  complexity: Complexity;
  score: number;
  fallback: boolean;
  description: string;
  useWhen?: string;
}

export interface SkillInfo {
  name: string;
  path: string;
  content: string;
}

// CSV row types
export interface CombinationRow {
  id: string;
  agent: string;
  skills: string;
  intent: string;
  domain: string;
  complexity: string;
  keywords: string;
  description: string;
  use_when: string;
}

export interface IntentRow {
  intent: string;
  agent: string;
  primary_keywords: string;
  expanded_keywords: string;
  action_verbs: string;
}

export interface DomainRow {
  domain: string;
  base_skills: string;
  enhanced_skills: string;
  keywords: string;
  frameworks: string;
}

export interface SynonymRow {
  word: string;
  synonyms: string;
  category: string;
}
