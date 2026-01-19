/**
 * Update command - Update GemKit CLI and/or Kits to latest version
 *
 * Two update sources:
 * 1. CLI (npm): gemkit-cli package from npm registry
 * 2. Kits (GitHub): .gemini folder from gemkit-kits-starter repo
 */

import type { CAC } from 'cac';
import { spawnSync } from 'child_process';
import { getLatestRelease } from '../../domains/github/releases.js';
import { downloadRelease } from '../../domains/github/download.js';
import { extractTarGz } from '../../services/archive.js';
import { loadMetadata, saveMetadata } from '../../domains/installation/metadata.js';
import { getLocalGeminiDir } from '../../utils/paths.js';
import { logger } from '../../services/logger.js';
import { brand } from '../../utils/colors.js';
import { getLatestNpmVersion, isUpdateAvailable } from '../../services/npm.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Package name for CLI
const CLI_PACKAGE_NAME = 'gemkit-cli';

// Get current CLI version from package.json dynamically
function getCliVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // Try multiple possible locations for package.json
    // After esbuild bundling: dist/index.js -> ../package.json
    // During development: src/commands/update/index.ts -> ../../../package.json
    const paths = [
      join(__dirname, '..', 'package.json'), // from dist/ (bundled)
      join(__dirname, '..', '..', '..', 'package.json'), // from src/commands/update/ (dev)
    ];

    for (const pkgPath of paths) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === CLI_PACKAGE_NAME && pkg.version) {
          return pkg.version;
        }
      } catch {
        // Try next path
      }
    }
  } catch {
    // Ignore errors
  }
  return '0.0.0'; // Fallback
}

const CLI_VERSION = getCliVersion();

interface UpdateOptions {
  force?: boolean;
  backup?: boolean;
  cli?: boolean;
  kits?: boolean;
}

export function registerUpdateCommand(cli: CAC): void {
  cli
    .command('update', 'Update GemKit CLI and/or Kits to latest version')
    .option('-f, --force', 'Force update even if already up to date')
    .option('--no-backup', 'Disable backup before kits update')
    .option('--cli', 'Update CLI only (npm package)')
    .option('--kits', 'Update Kits only (.gemini folder)')
    .action(async (options: UpdateOptions) => {
      // Default: update both if no specific flag
      const updateCli = options.cli === true || (!options.cli && !options.kits);
      const updateKits = options.kits === true || (!options.cli && !options.kits);

      let cliUpdated = false;
      let kitsUpdated = false;

      // Update CLI if requested
      if (updateCli) {
        cliUpdated = await updateCliPackage(options.force);
      }

      // Update Kits if requested
      if (updateKits) {
        kitsUpdated = await updateKitsFolder(options.force);
      }

      // Summary
      console.log();
      if (cliUpdated || kitsUpdated) {
        logger.success('Update complete!');
      } else {
        logger.info('Everything is up to date.');
      }
    });
}

/**
 * Update CLI via npm
 */
async function updateCliPackage(force?: boolean): Promise<boolean> {
  console.log();
  logger.info(`${brand.primary('CLI')} Checking for updates...`);

  const latest = await getLatestNpmVersion(CLI_PACKAGE_NAME);

  if (!latest) {
    logger.warn('Failed to check npm registry for CLI updates.');
    return false;
  }

  const currentVersion = CLI_VERSION;
  const latestVersion = latest.version;

  if (!isUpdateAvailable(currentVersion, latestVersion) && !force) {
    logger.success(`CLI is up to date (v${currentVersion})`);
    return false;
  }

  logger.info(`Updating CLI: v${currentVersion} → v${latestVersion}`);

  // Run npm update
  const result = spawnSync('npm', ['install', '-g', `${CLI_PACKAGE_NAME}@latest`], {
    encoding: 'utf-8',
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    logger.error('CLI update failed. Try running manually:');
    logger.info(`  npm install -g ${CLI_PACKAGE_NAME}@latest`);
    return false;
  }

  logger.success(`CLI updated to v${latestVersion}`);
  return true;
}

/**
 * Update Kits from GitHub
 */
async function updateKitsFolder(force?: boolean): Promise<boolean> {
  console.log();
  logger.info(`${brand.primary('Kits')} Checking for updates...`);

  const metadata = loadMetadata();
  if (!metadata) {
    logger.warn('GemKit not initialized. Run "gk init" first to install kits.');
    return false;
  }

  const latest = await getLatestRelease();

  if (!latest) {
    logger.warn('Failed to check GitHub for kits updates.');
    return false;
  }

  if (latest.version === metadata.version && !force) {
    logger.success(`Kits are up to date (v${metadata.version})`);
    return false;
  }

  logger.info(`Updating Kits: v${metadata.version} → v${latest.version}`);

  // Download and extract to temp
  const tarPath = await downloadRelease(latest);
  const extractDir = getLocalGeminiDir();

  const result = await extractTarGz({
    source: tarPath,
    destination: extractDir,
    strip: 1,
  });

  if (!result.success) {
    logger.error(`Kits update failed: ${result.error}`);
    return false;
  }

  // Update metadata
  const newMetadata = {
    ...metadata,
    version: latest.version,
    installedAt: new Date().toISOString(),
    installedFiles: result.extractedFiles,
  };
  saveMetadata(newMetadata);

  logger.success(`Kits updated to v${latest.version}`);
  return true;
}

/**
 * Check for updates (used by auto-update checker)
 */
export async function checkForUpdates(): Promise<{
  cli: { current: string; latest: string; available: boolean } | null;
  kits: { current: string; latest: string; available: boolean } | null;
}> {
  const result: {
    cli: { current: string; latest: string; available: boolean } | null;
    kits: { current: string; latest: string; available: boolean } | null;
  } = {
    cli: null,
    kits: null,
  };

  // Check CLI
  try {
    const latestCli = await getLatestNpmVersion(CLI_PACKAGE_NAME);
    if (latestCli) {
      result.cli = {
        current: CLI_VERSION,
        latest: latestCli.version,
        available: isUpdateAvailable(CLI_VERSION, latestCli.version),
      };
    }
  } catch {
    // Ignore errors
  }

  // Check Kits
  try {
    const metadata = loadMetadata();
    const latestKits = await getLatestRelease();
    if (metadata && latestKits) {
      result.kits = {
        current: metadata.version,
        latest: latestKits.version,
        available: isUpdateAvailable(metadata.version, latestKits.version),
      };
    }
  } catch {
    // Ignore errors
  }

  return result;
}

// Export CLI version for use elsewhere
export { CLI_VERSION };