/**
 * Auto-update checker service
 *
 * Checks for updates on CLI startup based on config settings.
 * Uses a timestamp file to track last check time.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { loadConfig } from '../domains/config/manager.js';
import { checkForUpdates } from '../commands/update/index.js';
import { brand } from '../utils/colors.js';

// File to track last update check
const UPDATE_CHECK_FILE = join(homedir(), '.gemkit', 'last-update-check.json');

interface UpdateCheckState {
  lastCheck: string; // ISO timestamp
  notifiedCli?: string; // version already notified
  notifiedKits?: string; // version already notified
}

/**
 * Get last update check state
 */
function getLastCheckState(): UpdateCheckState | null {
  try {
    if (!existsSync(UPDATE_CHECK_FILE)) {
      return null;
    }
    return JSON.parse(readFileSync(UPDATE_CHECK_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Save update check state
 */
function saveCheckState(state: UpdateCheckState): void {
  try {
    const dir = dirname(UPDATE_CHECK_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(UPDATE_CHECK_FILE, JSON.stringify(state, null, 2));
  } catch {
    // Ignore errors
  }
}

/**
 * Check if enough time has passed since last check
 */
function shouldCheck(intervalHours: number): boolean {
  const state = getLastCheckState();
  if (!state) {
    return true;
  }

  const lastCheck = new Date(state.lastCheck);
  const now = new Date();
  const hoursSinceCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60);

  return hoursSinceCheck >= intervalHours;
}

/**
 * Run auto-update check on startup
 * This runs in the background and only shows notifications
 */
export async function runAutoUpdateCheck(): Promise<void> {
  const config = loadConfig();
  const updateConfig = config.update;

  // Skip if auto-check is disabled
  if (!updateConfig?.autoCheck) {
    return;
  }

  // Skip if not enough time has passed
  if (!shouldCheck(updateConfig.checkInterval)) {
    return;
  }

  try {
    const updates = await checkForUpdates();
    const state = getLastCheckState() || { lastCheck: '' };
    const notifications: string[] = [];

    // Check CLI updates
    if (updates.cli?.available && state.notifiedCli !== updates.cli.latest) {
      notifications.push(
        `${brand.primary('CLI')} update available: v${updates.cli.current} → v${updates.cli.latest}`
      );
      state.notifiedCli = updates.cli.latest;
    }

    // Check Kits updates
    if (updates.kits?.available && state.notifiedKits !== updates.kits.latest) {
      notifications.push(
        `${brand.primary('Kits')} update available: v${updates.kits.current} → v${updates.kits.latest}`
      );
      state.notifiedKits = updates.kits.latest;
    }

    // Show notifications
    if (notifications.length > 0) {
      console.log();
      console.log(brand.dim('─'.repeat(50)));
      console.log(`${brand.warn('⬆')} Updates available:`);
      notifications.forEach((n) => console.log(`  ${n}`));
      console.log(`  Run ${brand.primary('gk update')} to update.`);
      console.log(brand.dim('─'.repeat(50)));
      console.log();
    }

    // Save state
    state.lastCheck = new Date().toISOString();
    saveCheckState(state);
  } catch {
    // Silently fail - don't interrupt user workflow
  }
}

/**
 * Force check for updates (ignores interval)
 */
export async function forceUpdateCheck(): Promise<{
  cli: { current: string; latest: string; available: boolean } | null;
  kits: { current: string; latest: string; available: boolean } | null;
}> {
  const updates = await checkForUpdates();

  // Update state
  const state: UpdateCheckState = {
    lastCheck: new Date().toISOString(),
    notifiedCli: updates.cli?.latest,
    notifiedKits: updates.kits?.latest,
  };
  saveCheckState(state);

  return updates;
}