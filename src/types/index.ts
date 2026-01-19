/**
 * Core type definitions for GemKit CLI
 */

// ============ Config Types ============

export interface GemKitConfig {
  defaultScope: 'local' | 'global';
  github: {
    repo: string;
    apiUrl: string;
  };
  cache: {
    enabled: boolean;
    ttl: number;
  };
  installation: {
    excludePatterns: string[];
    backupOnUpdate: boolean;
  };
  ui: {
    colors: boolean;
    spinner: boolean;
    verbose: boolean;
  };
  paths: {
    plans?: string;
    agents?: string;
  };
  spawn: {
    defaultModel: string;
    music: boolean;
    musicFile?: string;
  };
  office?: {
    enabled: boolean;
    mode: 'web' | 'terminal' | 'both';
    port: number;
    autoOpen: boolean;
    sounds: boolean;
    refreshRate: number;
  };
  update?: {
    autoCheck: boolean;
    checkInterval: number; // hours between checks
    notifyOnly: boolean; // if true, only notify, don't auto-update
  };
}

// ============ Installation Types ============

export interface GemKitMetadata {
  name: string;
  version: string;
  installedAt: string;
  scope: 'local' | 'global';
  installedFiles: string[];
  customizedFiles: Array<{ path: string; hash: string }>;
}

export interface Release {
  version: string;
  tag: string;
  publishedAt: string;
  assets: ReleaseAsset[];
  prerelease: boolean;
}

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  downloadUrl: string;
}

// ============ Session Types ============

export interface GkSession {
  gkSessionId: string;
  geminiSessionId?: string;
  gkProjectHash: string;
  projectDir: string;
  status: 'active' | 'completed' | 'failed';
  startTime: string;
  endTime?: string;
  activePlan?: string;
  agents: GkAgent[];
}

export interface GkAgent {
  gkSessionId: string;
  geminiSessionId?: string;
  agentRole: string;
  model: string;
  prompt: string;
  status: 'active' | 'completed' | 'failed';
  startTime: string;
  endTime?: string;
  tokenUsage?: TokenUsage;
  injected?: {
    skills?: string[];
    context?: string[];
  };
}

export interface TokenUsage {
  input: number;
  output: number;
  cached: number;
  thoughts: number;
  tool: number;
  total: number;
}

// ============ Agent Types ============

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
  tokenUsage?: TokenUsage;
  agentRole?: string;
}

export interface SearchResult {
  agent: string;
  skills: string[];
  score: number;
  description: string;
}

// ============ Plan Types ============

export interface Plan {
  name: string;
  path: string;
  createdAt: string;
  isActive: boolean;
}

// ============ Extension Types ============

export interface Extension {
  name: string;
  path: string;
  skills: string[];
  tools: ExtensionTool[];
}

export interface ExtensionTool {
  name: string;
  description: string;
  command?: string;
}

// ============ Command Types ============

export interface CommandContext {
  cwd: string;
  verbose: boolean;
  json: boolean;
}
