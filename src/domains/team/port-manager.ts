/**
 * Port Manager - Allocates and releases ports for team agents
 * Port range: 3377-3476 (100 ports)
 * Uses file locking to prevent race conditions
 */

import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { PortAllocation, PortRegistry } from './types.js';
import { getPortsPath, readJson, atomicWrite, ensureDir, getTeamsDir } from './storage.js';

// Lock timeout
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_INTERVAL_MS = 50;

// Port range configuration
const PORT_RANGE_START = 3377;
const PORT_RANGE_END = 3476;
const PORT_COUNT = PORT_RANGE_END - PORT_RANGE_START + 1;

/**
 * Get lock file path
 */
function getLockPath(projectDir: string): string {
  return join(getTeamsDir(projectDir), 'ports.lock');
}

/**
 * Acquire file lock with retry
 */
function acquireLock(projectDir: string): boolean {
  const lockPath = getLockPath(projectDir);
  const startTime = Date.now();

  ensureDir(getTeamsDir(projectDir));

  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    try {
      // Check if lock exists and is stale (older than timeout)
      if (existsSync(lockPath)) {
        const lockContent = readFileSync(lockPath, 'utf8');
        const lockTime = parseInt(lockContent, 10);
        if (Date.now() - lockTime > LOCK_TIMEOUT_MS) {
          // Stale lock, remove it
          unlinkSync(lockPath);
        } else {
          // Lock held by another process, wait and retry
          const sleepMs = LOCK_RETRY_INTERVAL_MS + Math.random() * 50;
          const end = Date.now() + sleepMs;
          while (Date.now() < end) { /* busy wait */ }
          continue;
        }
      }

      // Try to create lock file with exclusive flag
      writeFileSync(lockPath, Date.now().toString(), { flag: 'wx' });
      return true;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Lock exists, retry
        const sleepMs = LOCK_RETRY_INTERVAL_MS + Math.random() * 50;
        const end = Date.now() + sleepMs;
        while (Date.now() < end) { /* busy wait */ }
        continue;
      }
      // Other error, try again
      continue;
    }
  }

  return false;
}

/**
 * Release file lock
 */
function releaseLock(projectDir: string): void {
  const lockPath = getLockPath(projectDir);
  try {
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  } catch {
    // Ignore errors on cleanup
  }
}

/**
 * Check if a process is running by PID
 * Uses Node.js native process.kill(pid, 0) which works cross-platform
 */
function isProcessRunning(pid: number): boolean {
  if (!pid || pid <= 0) return false;

  try {
    // Signal 0 checks if process exists without killing it
    // Works on both Windows and Unix in Node.js
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the port registry for a project
 */
export function getPortRegistry(projectDir: string): PortRegistry {
  const registry = readJson<PortRegistry>(getPortsPath(projectDir));
  return registry || {
    allocations: [],
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Save the port registry
 */
function savePortRegistry(projectDir: string, registry: PortRegistry): boolean {
  ensureDir(getTeamsDir(projectDir));
  registry.lastUpdated = new Date().toISOString();
  return atomicWrite(getPortsPath(projectDir), registry);
}

/**
 * Allocate a port for an agent
 * Returns allocated port number or null if no ports available
 * Uses file locking to prevent race conditions
 */
export function allocatePort(
  projectDir: string,
  agentId: string,
  teamId: string,
  pid: number | null = null
): number | null {
  // Acquire lock before reading/writing
  if (!acquireLock(projectDir)) {
    console.error('[PortManager] Failed to acquire lock');
    return null;
  }

  try {
    const registry = getPortRegistry(projectDir);

    // Check if agent already has a port
    const existing = registry.allocations.find(a => a.agentId === agentId);
    if (existing) {
      return existing.port;
    }

    // Find an available port
    const usedPorts = new Set(registry.allocations.map(a => a.port));

    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
      if (!usedPorts.has(port)) {
        const allocation: PortAllocation = {
          port,
          agentId,
          teamId,
          pid,
          allocatedAt: new Date().toISOString()
        };

        registry.allocations.push(allocation);

        if (savePortRegistry(projectDir, registry)) {
          return port;
        }
        return null;
      }
    }

    // No ports available
    return null;
  } finally {
    releaseLock(projectDir);
  }
}

/**
 * Release a port for an agent
 */
export function releasePort(projectDir: string, agentId: string): boolean {
  const registry = getPortRegistry(projectDir);

  const index = registry.allocations.findIndex(a => a.agentId === agentId);
  if (index === -1) {
    return true; // Already released
  }

  registry.allocations.splice(index, 1);
  return savePortRegistry(projectDir, registry);
}

/**
 * Release all ports for a team
 */
export function releaseTeamPorts(projectDir: string, teamId: string): boolean {
  const registry = getPortRegistry(projectDir);

  registry.allocations = registry.allocations.filter(a => a.teamId !== teamId);
  return savePortRegistry(projectDir, registry);
}

/**
 * Update PID for an allocated port
 */
export function updatePortPid(projectDir: string, agentId: string, pid: number): boolean {
  const registry = getPortRegistry(projectDir);

  const allocation = registry.allocations.find(a => a.agentId === agentId);
  if (!allocation) {
    return false;
  }

  allocation.pid = pid;
  return savePortRegistry(projectDir, registry);
}

/**
 * Get port for an agent
 */
export function getAgentPort(projectDir: string, agentId: string): number | null {
  const registry = getPortRegistry(projectDir);
  const allocation = registry.allocations.find(a => a.agentId === agentId);
  return allocation?.port ?? null;
}

/**
 * Get all allocations for a team
 */
export function getTeamPorts(projectDir: string, teamId: string): PortAllocation[] {
  const registry = getPortRegistry(projectDir);
  return registry.allocations.filter(a => a.teamId === teamId);
}

/**
 * Clean up stale port allocations (dead processes)
 * Returns number of ports cleaned up
 */
export async function cleanupStalePorts(projectDir: string): Promise<number> {
  const registry = getPortRegistry(projectDir);
  const initialCount = registry.allocations.length;

  // Filter out allocations for dead processes
  registry.allocations = registry.allocations.filter(allocation => {
    if (!allocation.pid) {
      // No PID tracked - keep it (may be starting up)
      return true;
    }
    return isProcessRunning(allocation.pid);
  });

  const cleaned = initialCount - registry.allocations.length;

  if (cleaned > 0) {
    savePortRegistry(projectDir, registry);
  }

  return cleaned;
}

/**
 * Get port allocation statistics
 */
export function getPortStats(projectDir: string): {
  total: number;
  used: number;
  available: number;
  byTeam: Record<string, number>;
} {
  const registry = getPortRegistry(projectDir);

  const byTeam: Record<string, number> = {};
  for (const allocation of registry.allocations) {
    byTeam[allocation.teamId] = (byTeam[allocation.teamId] || 0) + 1;
  }

  return {
    total: PORT_COUNT,
    used: registry.allocations.length,
    available: PORT_COUNT - registry.allocations.length,
    byTeam
  };
}
