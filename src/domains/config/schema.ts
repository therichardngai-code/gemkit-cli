/**
 * Configuration schema for GemKit CLI
 */

import type { GemKitConfig } from '../../types/index.js';

/**
 * Default configuration - uses starter repo
 */
export const DEFAULT_CONFIG: GemKitConfig = {
  defaultScope: 'local',
  github: {
    repo: 'therichardngai-code/gemkit-kits-starter',
    apiUrl: 'https://api.github.com',
  },
  cache: {
    enabled: true,
    ttl: 3600,
  },
  installation: {
    excludePatterns: [],
    backupOnUpdate: true,
  },
  ui: {
    colors: true,
    spinner: true,
    verbose: false,
  },
  paths: {},
  spawn: {
    defaultModel: 'gemini-2.5-flash',
    music: false,
  },
  office: {
    enabled: true,
    mode: 'web',
    port: 3847,
    autoOpen: true,
    sounds: false,
    refreshRate: 500,
  },
};

/**
 * Validate configuration object
 * Only validates it's a valid object - mergeConfig handles defaults
 */
export function validateConfig(config: unknown): config is GemKitConfig {
  if (!config || typeof config !== 'object') {
    return false;
  }

  // No strict field requirements - mergeConfig fills in defaults
  return true;
}

/**
 * Merge partial config with defaults
 */
export function mergeConfig(partial: Partial<GemKitConfig>): GemKitConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    github: {
      ...DEFAULT_CONFIG.github,
      ...(partial.github || {}),
    },
    cache: {
      ...DEFAULT_CONFIG.cache,
      ...(partial.cache || {}),
    },
    installation: {
      ...DEFAULT_CONFIG.installation,
      ...(partial.installation || {}),
    },
    ui: {
      ...DEFAULT_CONFIG.ui,
      ...(partial.ui || {}),
    },
    paths: {
      ...DEFAULT_CONFIG.paths,
      ...(partial.paths || {}),
    },
    spawn: {
      ...DEFAULT_CONFIG.spawn,
      ...(partial.spawn || {}),
    },
    office: {
      ...DEFAULT_CONFIG.office,
      ...(partial.office || {}),
    } as Exclude<GemKitConfig['office'], undefined>,
  };
}
