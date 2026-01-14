import type { CAC } from 'cac';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import ora from 'ora';
import { fetchReleases, getLatestRelease, getReleaseByVersion } from '../../domains/github/releases.js';
import { downloadRelease } from '../../domains/github/download.js';
import { extractTarGz } from '../../services/archive.js';
import { syncFiles } from '../../domains/installation/file-sync.js';
import { createMetadata, saveMetadata, isInstalled } from '../../domains/installation/metadata.js';
import { getExtensionsDir } from '../../utils/paths.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';

/**
 * Installation modes for different AI coding assistants
 */
type InstallMode = 'full' | 'gemini' | 'claude' | 'antigravity';

/**
 * Get exclusion patterns based on installation mode
 */
function getExcludePatterns(mode: InstallMode): string[] {
  switch (mode) {
    case 'gemini':
      // Exclude Claude and generic agent folders (Gemini uses .gemini)
      return ['.claude', '.claude/**', '.agent', '.agent/**'];
    case 'claude':
      // Exclude generic agent folder (Claude Code uses .claude)
      return ['.agent', '.agent/**'];
    case 'antigravity':
      // Exclude Claude folder (Antigravity uses .agent)
      return ['.claude', '.claude/**'];
    case 'full':
    default:
      // No exclusions - install everything
      return [];
  }
}

/**
 * Get mode description for display
 */
function getModeDescription(mode: InstallMode): string {
  switch (mode) {
    case 'gemini':
      return 'Gemini CLI (excludes .claude, .agent)';
    case 'claude':
      return 'Claude Code (excludes .agent)';
    case 'antigravity':
      return 'Antigravity (excludes .claude)';
    case 'full':
    default:
      return 'Full (all files)';
  }
}

/**
 * Check if a path matches any of the exclude patterns
 * Supports simple directory patterns like '.claude', '.claude/**'
 */
function shouldExclude(filePath: string, excludePatterns: string[]): boolean {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, '/');

  for (const pattern of excludePatterns) {
    // Simple directory match: '.claude' or '.agent'
    if (!pattern.includes('*')) {
      if (normalizedPath === pattern || normalizedPath.startsWith(pattern + '/')) {
        return true;
      }
    }
    // Glob pattern: '.claude/**' means anything under .claude
    else if (pattern.endsWith('/**')) {
      const baseDir = pattern.slice(0, -3); // Remove '/**'
      if (normalizedPath.startsWith(baseDir + '/')) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Create a filter function for extraction based on exclude patterns
 */
function createExcludeFilter(excludePatterns: string[]): ((path: string) => boolean) | undefined {
  if (excludePatterns.length === 0) {
    return undefined; // No filtering needed
  }

  return (path: string) => {
    // Return true to INCLUDE the file, false to EXCLUDE
    return !shouldExclude(path, excludePatterns);
  };
}

/**
 * Install spawn-agent extension using gemini CLI (silent - for use with spinner)
 * Runs: gemini extensions install .gemini/extensions/spawn-agent
 */
async function installSpawnAgentExtensionSilent(): Promise<{ success: boolean; error?: string }> {
  const extensionPath = join('.gemini', 'extensions', 'spawn-agent');

  // Check if extension directory exists
  if (!existsSync(extensionPath)) {
    return {
      success: false,
      error: `Extension directory not found: ${extensionPath}`
    };
  }

  return new Promise((resolve) => {
    const child = spawn('gemini', ['extensions', 'install', extensionPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      cwd: process.cwd()
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    // Timeout after 30 seconds
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        resolve({
          success: false,
          error: 'Extension installation timed out'
        });
      }
    }, 30000);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: stderr || stdout || `Exit code: ${code}`
          });
        }
      }
    });

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          success: false,
          error: `Failed to run gemini CLI: ${err.message}`
        });
      }
    });
  });
}

/**
 * Check if spawn-agent extension is installed in Gemini
 */
export async function isSpawnAgentInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('gemini', ['extensions', 'list'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });

    let stdout = '';
    let resolved = false;

    // Timeout after 20 seconds
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        resolve(false);
      }
    }, 20000);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        if (code === 0) {
          // Check if spawn-agent appears in the output
          const isInstalled = stdout.toLowerCase().includes('spawn-agent');
          resolve(isInstalled);
        } else {
          resolve(false);
        }
      }
    });

    child.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(false);
      }
    });
  });
}

export function registerInitCommand(cli: CAC): void {
  cli
    .command('init', 'Initialize GemKit in project')
    .option('--version <ver>', 'Specific version to install')
    .option('-f, --force', 'Overwrite existing installation')
    .option('--exclude <patterns...>', 'File patterns to exclude')
    .option('--skip-extension', 'Skip spawn-agent extension installation')
    .option('--full', 'Install all files (default)')
    .option('--gemini', 'Gemini CLI mode (excludes .claude, .agent folders)')
    .option('--claude', 'Claude Code mode (excludes .agent folder)')
    .option('--antigravity', 'Antigravity mode (excludes .claude folder)')
    .action(async (options: {
      version?: string;
      force?: boolean;
      exclude?: string[];
      skipExtension?: boolean;
      full?: boolean;
      gemini?: boolean;
      claude?: boolean;
      antigravity?: boolean;
    }) => {
      // Determine installation mode (priority: gemini > claude > antigravity > full)
      let mode: InstallMode = 'full';
      if (options.gemini) mode = 'gemini';
      else if (options.claude) mode = 'claude';
      else if (options.antigravity) mode = 'antigravity';
      else if (options.full) mode = 'full';

      // Check if already installed
      if (isInstalled() && !options.force) {
        console.log();
        logger.warn('GemKit is already installed. Use --force to reinstall.');
        console.log();
        return;
      }

      console.log();
      console.log(pc.bold(brand.geminiPurple('Initializing GemKit')));
      console.log(`  ${brand.dim('Mode:')} ${brand.accent(getModeDescription(mode))}`);
      console.log();

      // Step 1: Fetch release info
      const fetchSpinner = ora({
        text: 'Fetching latest release...',
        color: 'magenta'
      }).start();

      const release = options.version
        ? await getReleaseByVersion(options.version)
        : await getLatestRelease();

      if (!release) {
        fetchSpinner.fail('No release found');
        console.log();
        process.exit(1);
      }

      fetchSpinner.succeed(`Found version ${brand.primary(release.version)}`);

      // Step 2: Download release
      const downloadSpinner = ora({
        text: 'Downloading release...',
        color: 'magenta'
      }).start();

      let tarPath: string;
      try {
        tarPath = await downloadRelease(release);
        downloadSpinner.succeed('Download complete');
      } catch (error) {
        downloadSpinner.fail(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
        console.log();
        process.exit(1);
      }

      // Step 3: Extract files
      const excludePatterns = getExcludePatterns(mode);
      const extractSpinner = ora({
        text: mode === 'full' ? 'Extracting files...' : `Extracting files (${mode} mode)...`,
        color: 'magenta'
      }).start();

      const extractDir = process.cwd();
      const result = await extractTarGz({
        source: tarPath,
        destination: extractDir,
        strip: 1,
        filter: createExcludeFilter(excludePatterns),
      });

      if (!result.success) {
        extractSpinner.fail(`Extraction failed: ${result.error}`);
        console.log();
        process.exit(1);
      }

      extractSpinner.succeed(`Extracted ${result.extractedFiles.length} files`);

      // Save metadata
      const metadata = createMetadata(release.version, 'local', result.extractedFiles);
      saveMetadata(metadata);

      console.log();
      logger.success(`GemKit ${brand.primary(release.version)} installed successfully!`);

      // Step 4: Install spawn-agent extension (unless skipped or using non-Gemini mode)
      const shouldInstallExtension = !options.skipExtension && (mode === 'full' || mode === 'gemini');
      if (shouldInstallExtension) {
        console.log();
        const extensionSpinner = ora({
          text: 'Installing spawn-agent extension...',
          color: 'magenta'
        }).start();

        const extensionResult = await installSpawnAgentExtensionSilent();

        if (extensionResult.success) {
          extensionSpinner.succeed('spawn-agent extension installed in Gemini CLI');
        } else {
          extensionSpinner.warn(`Could not install spawn-agent extension: ${extensionResult.error}`);
          logger.info(`You can manually install it with: ${brand.primary('gemini extensions install .gemini/extensions/spawn-agent')}`);
        }
      } else if (mode === 'claude' || mode === 'antigravity') {
        console.log();
        logger.info(`Skipped Gemini extension (${mode} mode).`);
      }

      console.log();
      logger.info(`Run ${brand.primary('gk doctor')} to verify installation.`);
      console.log();
    });
}