/**
 * Configuration manager
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { GemKitConfig } from '../../types/index.js';
import { getLocalConfigPath, GEMKIT_CONFIG_DIR } from '../../utils/paths.js';
import { DEFAULT_CONFIG, mergeConfig, validateConfig } from './schema.js';
import { ConfigError } from '../../utils/errors.js';

/**
 * Load configuration from file
 */
export function loadConfig(projectDir?: string): GemKitConfig {
  const configPath = getLocalConfigPath(projectDir);

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);

    if (!validateConfig(parsed)) {
      throw new ConfigError('Invalid configuration format');
    }

    return mergeConfig(parsed);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError(`Failed to load config: ${error}`);
  }
}

/**
 * Save configuration to file
 */
export function saveConfig(config: GemKitConfig, projectDir?: string): void {
  const configPath = getLocalConfigPath(projectDir);
  const dir = dirname(configPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Get a specific config value by path
 */
export function getConfigValue(path: string, projectDir?: string): unknown {
  const config = loadConfig(projectDir);
  const keys = path.split('.');

  let value: unknown = config;
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = (value as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * Set a specific config value by path
 */
export function setConfigValue(path: string, value: unknown, projectDir?: string): void {
  const config = loadConfig(projectDir);
  const keys = path.split('.');
  const lastKey = keys.pop();

  if (!lastKey) {
    throw new ConfigError('Invalid config path');
  }

  let obj = config as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (!(key in obj) || typeof obj[key] !== 'object') {
      obj[key] = {};
    }
    obj = obj[key] as Record<string, unknown>;
  }

  obj[lastKey] = value;
  saveConfig(config as GemKitConfig, projectDir);
}

/**
 * Reset config to defaults
 */
export function resetConfig(projectDir?: string): void {
  saveConfig(DEFAULT_CONFIG, projectDir);
}
