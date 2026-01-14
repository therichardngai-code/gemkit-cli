import type { CAC } from 'cac';
import { existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import ora from 'ora';
import { getLocalGeminiDir, getAgentsDir, getExtensionsDir } from '../../utils/paths.js';
import { loadMetadata } from '../../domains/installation/metadata.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';

/**
 * Check if spawn-agent extension is installed in Gemini CLI
 * by running: gemini extensions list
 */
async function checkSpawnAgentInstalled(): Promise<{ installed: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('gemini', ['extensions', 'list'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    // Timeout after 20 seconds (gemini CLI can be slow)
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        resolve({
          installed: false,
          error: 'Check timed out'
        });
      }
    }, 20000);

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
          // Check if spawn-agent appears in the output
          const isInstalled = stdout.toLowerCase().includes('spawn-agent');
          resolve({ installed: isInstalled });
        } else {
          resolve({
            installed: false,
            error: stderr || 'Failed to check extensions'
          });
        }
      }
    });

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          installed: false,
          error: `Gemini CLI not available: ${err.message}`
        });
      }
    });
  });
}

/**
 * Check if Gemini CLI is available
 */
async function checkGeminiCli(): Promise<{ available: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('gemini', ['--version'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });

    let stdout = '';
    let resolved = false;

    // Timeout after 15 seconds (gemini CLI can be slow to start)
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        resolve({ available: false, error: 'Timed out' });
      }
    }, 15000);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        if (code === 0) {
          const version = stdout.trim().split('\n')[0] || 'unknown';
          resolve({ available: true, version });
        } else {
          resolve({ available: false, error: 'Command failed' });
        }
      }
    });

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ available: false, error: err.message });
      }
    });
  });
}

export function registerDoctorCommand(cli: CAC): void {
  cli
    .command('doctor', 'Check installation health')
    .option('--fix', 'Attempt to fix issues')
    .action(async (options: { fix?: boolean }) => {
      console.log();
      console.log(pc.bold(brand.geminiPurple('GemKit Health Check')));
      console.log();

      let issues = 0;
      let warnings = 0;

      // Results storage for display after all checks
      const results: { icon: string; message: string; hint?: string }[] = [];

      // Check Node.js version (sync - instant)
      const nodeVersion = process.version;
      const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
      if (major >= 18) {
        results.push({ icon: brand.success('✓'), message: `Node.js ${nodeVersion}` });
      } else {
        results.push({ icon: brand.error('✗'), message: `Node.js ${nodeVersion} ${brand.error('(requires >= 18)')}` });
        issues++;
      }

      // Check Gemini CLI (async - with spinner)
      const geminiSpinner = ora({
        text: 'Checking Gemini CLI...',
        color: 'magenta'
      }).start();

      const geminiCheck = await checkGeminiCli();
      geminiSpinner.stop();

      if (geminiCheck.available) {
        results.push({ icon: brand.success('✓'), message: `Gemini CLI ${brand.dim(`(${geminiCheck.version})`)}` });
      } else {
        results.push({ icon: brand.error('✗'), message: `Gemini CLI not found ${brand.dim(`(${geminiCheck.error})`)}` });
        issues++;
      }

      // Check .gemini directory (sync)
      const geminiDir = getLocalGeminiDir();
      if (existsSync(geminiDir)) {
        results.push({ icon: brand.success('✓'), message: '.gemini directory exists' });
      } else {
        results.push({ icon: brand.error('✗'), message: '.gemini directory missing' });
        issues++;
      }

      // Check agents directory (sync)
      const agentsDir = getAgentsDir();
      if (existsSync(agentsDir)) {
        results.push({ icon: brand.success('✓'), message: 'Agents directory exists' });
      } else {
        results.push({ icon: brand.warn('○'), message: 'Agents directory missing' });
        warnings++;
      }

      // Check extensions directory (sync)
      const extensionsDir = getExtensionsDir();
      if (existsSync(extensionsDir)) {
        results.push({ icon: brand.success('✓'), message: 'Extensions directory exists' });
      } else {
        results.push({ icon: brand.warn('○'), message: 'Extensions directory missing' });
        warnings++;
      }

      // Check spawn-agent extension directory exists locally (sync)
      const spawnAgentDir = join(extensionsDir, 'spawn-agent');
      if (existsSync(spawnAgentDir)) {
        results.push({ icon: brand.success('✓'), message: 'spawn-agent extension files present' });
      } else {
        results.push({ icon: brand.warn('○'), message: 'spawn-agent extension files missing' });
        warnings++;
      }

      // Check spawn-agent extension is installed in Gemini CLI (async - with spinner)
      if (geminiCheck.available) {
        const extensionSpinner = ora({
          text: 'Checking spawn-agent extension...',
          color: 'magenta'
        }).start();

        const spawnAgentCheck = await checkSpawnAgentInstalled();
        extensionSpinner.stop();

        if (spawnAgentCheck.installed) {
          results.push({ icon: brand.success('✓'), message: 'spawn-agent extension installed in Gemini' });
        } else {
          results.push({
            icon: brand.error('✗'),
            message: 'spawn-agent extension NOT installed in Gemini',
            hint: spawnAgentCheck.error
              ? `${spawnAgentCheck.error}\n    Run: gemini extensions install .gemini/extensions/spawn-agent`
              : 'Run: gemini extensions install .gemini/extensions/spawn-agent'
          });
          issues++;
        }
      }

      // Check metadata (sync)
      const metadata = loadMetadata();
      if (metadata) {
        results.push({ icon: brand.success('✓'), message: `Installation metadata ${brand.primary(`(v${metadata.version})`)}` });
      } else {
        results.push({ icon: brand.warn('○'), message: 'Installation metadata missing' });
        warnings++;
      }

      // Display all results
      for (const result of results) {
        console.log(`  ${result.icon} ${result.message}`);
        if (result.hint) {
          for (const line of result.hint.split('\n')) {
            console.log(`    ${brand.dim(line)}`);
          }
        }
      }

      // Summary
      console.log();
      if (issues === 0 && warnings === 0) {
        console.log(brand.success('All checks passed!'));
      } else if (issues === 0) {
        console.log(brand.success(`All critical checks passed! ${brand.dim(`(${warnings} warning${warnings > 1 ? 's' : ''})`)}`));
      } else {
        console.log(brand.error(`${issues} issue(s) found.`));
        if (warnings > 0) {
          console.log(brand.warn(`${warnings} warning(s).`));
        }
        console.log();
        console.log('To fix issues:');
        console.log(`  ${brand.dim('1.')} Run ${brand.primary('gk init')} to install GemKit`);
        console.log(`  ${brand.dim('2.')} Run ${brand.primary('gemini extensions install .gemini/extensions/spawn-agent')} to install extension`);
      }
      console.log();
    });
}
