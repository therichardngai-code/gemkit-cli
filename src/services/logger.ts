/**
 * Logging service for GemKit CLI
 */

import { brand, pc } from '../utils/colors.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

interface LoggerConfig {
  level: LogLevel;
  verbose: boolean;
  json: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

let config: LoggerConfig = {
  level: 'info',
  verbose: false,
  json: false,
};

export function configureLogger(options: Partial<LoggerConfig>): void {
  config = { ...config, ...options };
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[config.level];
}

export function debug(message: string, data?: unknown): void {
  if (!shouldLog('debug')) return;
  if (config.json) {
    console.log(JSON.stringify({ level: 'debug', message, data }));
  } else {
    console.log(brand.dim(`[DEBUG] ${message}`));
    if (data && config.verbose) {
      console.log(brand.dim(JSON.stringify(data, null, 2)));
    }
  }
}

export function info(message: string, data?: unknown): void {
  if (!shouldLog('info')) return;
  if (config.json) {
    console.log(JSON.stringify({ level: 'info', message, data }));
  } else {
    console.log(`${brand.info('ℹ')} ${message}`);
    if (data && config.verbose) {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

export function success(message: string, data?: unknown): void {
  if (!shouldLog('info')) return;
  if (config.json) {
    console.log(JSON.stringify({ level: 'success', message, data }));
  } else {
    console.log(`${brand.success('✓')} ${message}`);
  }
}

export function warn(message: string, data?: unknown): void {
  if (!shouldLog('warn')) return;
  if (config.json) {
    console.log(JSON.stringify({ level: 'warn', message, data }));
  } else {
    console.log(`${brand.warn('⚠')} ${message}`);
  }
}

export function error(message: string, data?: unknown): void {
  if (!shouldLog('error')) return;
  if (config.json) {
    console.error(JSON.stringify({ level: 'error', message, data }));
  } else {
    console.error(`${brand.error('✗')} ${message}`);
    if (data && config.verbose) {
      console.error(JSON.stringify(data, null, 2));
    }
  }
}

export function table(data: Record<string, unknown>[]): void {
  if (config.json) {
    console.log(JSON.stringify(data));
  } else {
    console.table(data);
  }
}

export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export const logger = {
  debug,
  info,
  success,
  warn,
  error,
  table,
  json,
  configure: configureLogger,
};