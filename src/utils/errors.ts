/**
 * Custom error classes for GemKit CLI
 */

export class GemKitError extends Error {
  constructor(
    message: string,
    public code: string = 'GEMKIT_ERROR',
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'GemKitError';
  }
}

export class ConfigError extends GemKitError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', details);
    this.name = 'ConfigError';
  }
}

export class InstallationError extends GemKitError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'INSTALLATION_ERROR', details);
    this.name = 'InstallationError';
  }
}

export class SessionError extends GemKitError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SESSION_ERROR', details);
    this.name = 'SessionError';
  }
}

export class AgentError extends GemKitError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'AGENT_ERROR', details);
    this.name = 'AgentError';
  }
}

export class GitHubError extends GemKitError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'GITHUB_ERROR', details);
    this.name = 'GitHubError';
  }
}

export function formatErrorForDisplay(error: unknown): string {
  if (error instanceof GemKitError) {
    let message = `[${error.code}] ${error.message}`;
    if (error.details) {
      message += `\nDetails: ${JSON.stringify(error.details, null, 2)}`;
    }
    return message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
