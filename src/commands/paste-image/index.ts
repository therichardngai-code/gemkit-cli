/**
 * gk paste-image - Capture clipboard image for Gemini analysis
 */

import type { CAC } from 'cac';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getGeminiProjectHash } from '../../domains/session/env.js';
import { brand, ui, pc } from '../../utils/colors.js';

const IMAGE_PREFIX = 'clipboard-image';

interface CaptureResult {
  success: boolean;
  path?: string;
  error?: string;
  suggestion?: string;
  platform?: string;
  tempDir?: string;
}

export function registerPasteImageCommand(cli: CAC): void {
  cli
    .command('paste-image', 'Capture clipboard image for Gemini analysis')
    .alias('pi')
    .option('--format <fmt>', 'Image format (png, jpg)', { default: 'png' })
    .option('--json', 'Output as JSON')
    .action(async (options: { format?: string; json?: boolean }) => {
      const result = pasteImage(options);
      const output = formatOutput(result);

      if (options.json) {
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log();
        if (output.success) {
          console.log(`${brand.success('✓')} Image captured: ${brand.primary(String(output.path))}`);
          console.log(`  ${brand.dim('Size:')}     ${output.size}`);
          console.log(`  ${brand.dim('Platform:')} ${output.platform}`);
        } else {
          console.error(`${brand.error('✗')} ${output.error}`);
          if (output.suggestion) {
            console.log(`  ${brand.dim('Hint:')} ${output.suggestion}`);
          }
        }
        console.log();
      }

      process.exit(result.success ? 0 : 1);
    });
}

function getTempDir(): string {
  const projectHash = getGeminiProjectHash();

  if (projectHash) {
    const tempDir = join(homedir(), '.gemini', 'tmp', projectHash);
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }
    return tempDir;
  }

  const fallbackDir = join(process.cwd(), '.gemini', 'tmp', 'clipboard');
  if (!existsSync(fallbackDir)) {
    mkdirSync(fallbackDir, { recursive: true });
  }
  return fallbackDir;
}

function generateFilename(format = 'png'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${IMAGE_PREFIX}-${timestamp}-${random}.${format}`;
}

function pasteImage(options: { format?: string }): CaptureResult {
  const format = options.format || 'png';
  const platform = process.platform;
  const tempDir = getTempDir();
  const filename = generateFilename(format);
  const filepath = join(tempDir, filename);

  let result: CaptureResult;

  switch (platform) {
    case 'win32':
      result = captureWindows(filepath);
      break;
    case 'darwin':
      result = captureMacOS(filepath);
      break;
    case 'linux':
      result = captureLinux(filepath);
      break;
    default:
      result = { success: false, error: `Unsupported platform: ${platform}` };
  }

  result.platform = platform;
  result.tempDir = tempDir;
  return result;
}

// Windows: PowerShell
function captureWindows(filepath: string): CaptureResult {
  const escapedPath = filepath.replace(/\\/g, '\\\\');
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$clipboard = [System.Windows.Forms.Clipboard]::GetImage()
if ($clipboard -eq $null) { Write-Error "NO_IMAGE"; exit 1 }
$dir = Split-Path -Parent "${escapedPath}"
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$clipboard.Save("${escapedPath}", [System.Drawing.Imaging.ImageFormat]::Png)
$clipboard.Dispose()
Write-Output "SUCCESS"
  `.trim();

  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
    encoding: 'utf-8',
    windowsHide: true
  });

  if (result.stderr?.includes('NO_IMAGE')) {
    return { success: false, error: 'No image in clipboard. Copy an image first.' };
  }
  if (result.status !== 0) {
    return { success: false, error: `Failed: ${result.stderr || result.stdout}`.trim() };
  }
  return existsSync(filepath) ? { success: true, path: filepath } : { success: false, error: 'File not created' };
}

// macOS: pngpaste
function captureMacOS(filepath: string): CaptureResult {
  const which = spawnSync('which', ['pngpaste'], { encoding: 'utf-8' });
  if (which.status === 0) {
    const paste = spawnSync('pngpaste', [filepath], { encoding: 'utf-8' });
    if (paste.status === 0 && existsSync(filepath)) {
      return { success: true, path: filepath };
    }
  }
  return { success: false, error: 'No image or pngpaste failed', suggestion: 'brew install pngpaste' };
}

// Linux: xclip
function captureLinux(filepath: string): CaptureResult {
  const which = spawnSync('which', ['xclip'], { encoding: 'utf-8' });
  if (which.status !== 0) {
    return { success: false, error: 'xclip not installed', suggestion: 'apt install xclip' };
  }

  const targets = spawnSync('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o'], { encoding: 'utf-8' });
  if (!targets.stdout?.includes('image/png') && !targets.stdout?.includes('image/jpeg')) {
    return { success: false, error: 'No image in clipboard' };
  }

  const type = targets.stdout.includes('image/png') ? 'image/png' : 'image/jpeg';
  const result = spawnSync('xclip', ['-selection', 'clipboard', '-t', type, '-o'], { encoding: 'buffer' });

  if (result.status !== 0 || !result.stdout?.length) {
    return { success: false, error: 'Failed to read clipboard' };
  }

  writeFileSync(filepath, result.stdout);
  return existsSync(filepath) ? { success: true, path: filepath } : { success: false, error: 'Save failed' };
}

function formatOutput(result: CaptureResult): Record<string, unknown> {
  if (result.success && result.path) {
    const stats = statSync(result.path);
    return {
      success: true,
      message: 'Image captured',
      path: result.path,
      size: `${(stats.size / 1024).toFixed(1)} KB`,
      platform: result.platform
    };
  }
  return { success: false, error: result.error, suggestion: result.suggestion, platform: result.platform };
}
