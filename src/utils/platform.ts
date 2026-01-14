/**
 * Platform detection utilities
 */

export type Platform = 'win32' | 'darwin' | 'linux' | 'unknown';

export function getPlatform(): Platform {
  const platform = process.platform;
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    return platform;
  }
  return 'unknown';
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

export function isLinux(): boolean {
  return process.platform === 'linux';
}

export function getShell(): string {
  if (isWindows()) {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/sh';
}

export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '';
}

export function getPathSeparator(): string {
  return isWindows() ? ';' : ':';
}
