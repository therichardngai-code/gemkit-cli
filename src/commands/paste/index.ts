/**
 * gk paste - Capture clipboard image or video for Gemini analysis
 *
 * Usage:
 *   gk paste           - Capture image (default)
 *   gk paste --image   - Capture image explicitly
 *   gk paste --video   - Capture video from clipboard or recent recordings
 */

import type { CAC } from 'cac';
import { spawnSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  statSync,
  copyFileSync,
  readdirSync
} from 'fs';
import { join, extname } from 'path';
import { homedir } from 'os';
import { getGeminiProjectHash } from '../../domains/session/env.js';
import { brand } from '../../utils/colors.js';

// ============================================================================
// Constants
// ============================================================================

const IMAGE_PREFIX = 'clipboard-image';
const VIDEO_PREFIX = 'clipboard-video';
const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.gif'];
const RECENT_FILE_THRESHOLD_MINUTES = 5;

// ============================================================================
// Types
// ============================================================================

interface CaptureResult {
  success: boolean;
  path?: string;
  sourcePath?: string;
  sourceType?: 'clipboard' | 'snipping-tool' | 'recent-recording';
  error?: string;
  suggestion?: string;
  platform?: string;
  tempDir?: string;
}

interface PasteOptions {
  image?: boolean;
  video?: boolean;
  format?: string;
  json?: boolean;
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerPasteCommand(cli: CAC): void {
  cli
    .command('paste', 'Capture clipboard image or video for Gemini analysis')
    .alias('p')
    .option('--image', 'Capture image from clipboard (default)')
    .option('--video', 'Capture video from clipboard or recent recordings')
    .option('--format <fmt>', 'Image format (png, jpg)', { default: 'png' })
    .option('--json', 'Output as JSON')
    .action(async (options: PasteOptions) => {
      // Default to image if neither specified
      const captureVideo = options.video === true;

      const result = captureVideo ? pasteVideo() : pasteImage(options);
      const output = captureVideo ? formatVideoOutput(result) : formatImageOutput(result);

      if (options.json) {
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log();
        if (output.success) {
          const type = captureVideo ? 'Video' : 'Image';
          console.log(`${brand.success('✓')} ${type} captured successfully`);
          console.log();
          console.log(`  ${brand.dim('Path:')}     ${brand.primary(String(output.path))}`);
          console.log(`  ${brand.dim('Size:')}     ${output.size}`);
          if (captureVideo && output.format) {
            console.log(`  ${brand.dim('Format:')}   ${output.format}`);
          }
          if (output.sourceType && output.sourceType !== 'clipboard') {
            console.log(`  ${brand.dim('Source:')}   ${output.sourceType}`);
          }
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

// ============================================================================
// Shared Utilities
// ============================================================================

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

function generateImageFilename(format = 'png'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${IMAGE_PREFIX}-${timestamp}-${random}.${format}`;
}

function generateVideoFilename(originalExt = '.mp4'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ext = SUPPORTED_VIDEO_EXTENSIONS.includes(originalExt.toLowerCase()) ? originalExt : '.mp4';
  return `${VIDEO_PREFIX}-${timestamp}-${random}${ext}`;
}

function isVideoFile(filepath: string): boolean {
  const ext = extname(filepath).toLowerCase();
  return SUPPORTED_VIDEO_EXTENSIONS.includes(ext);
}

function findRecentVideoInFolders(folders: string[], destDir: string): CaptureResult | null {
  for (const folder of folders) {
    if (!existsSync(folder)) continue;

    try {
      const files = readdirSync(folder)
        .filter((f) => isVideoFile(f))
        .map((f) => {
          const fullPath = join(folder, f);
          return {
            name: f,
            path: fullPath,
            mtime: statSync(fullPath).mtime
          };
        })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      if (files.length > 0) {
        const recent = files[0];
        const ageMinutes = (Date.now() - recent.mtime.getTime()) / 60000;

        if (ageMinutes <= RECENT_FILE_THRESHOLD_MINUTES) {
          const ext = extname(recent.path);
          const destFilename = generateVideoFilename(ext);
          const destPath = join(destDir, destFilename);

          copyFileSync(recent.path, destPath);

          if (existsSync(destPath)) {
            return {
              success: true,
              path: destPath,
              sourcePath: recent.path,
              sourceType: 'recent-recording'
            };
          }
        }
      }
    } catch {
      // Continue to next folder
    }
  }
  return null;
}

// ============================================================================
// Image Capture Functions
// ============================================================================

function pasteImage(options: { format?: string }): CaptureResult {
  const format = options.format || 'png';
  const platform = process.platform;
  const tempDir = getTempDir();
  const filename = generateImageFilename(format);
  const filepath = join(tempDir, filename);

  let result: CaptureResult;

  switch (platform) {
    case 'win32':
      result = captureImageWindows(filepath);
      break;
    case 'darwin':
      result = captureImageMacOS(filepath);
      break;
    case 'linux':
      result = captureImageLinux(filepath);
      break;
    default:
      result = { success: false, error: `Unsupported platform: ${platform}` };
  }

  result.platform = platform;
  result.tempDir = tempDir;
  return result;
}

function captureImageWindows(filepath: string): CaptureResult {
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

function captureImageMacOS(filepath: string): CaptureResult {
  const which = spawnSync('which', ['pngpaste'], { encoding: 'utf-8' });
  if (which.status === 0) {
    const paste = spawnSync('pngpaste', [filepath], { encoding: 'utf-8' });
    if (paste.status === 0 && existsSync(filepath)) {
      return { success: true, path: filepath };
    }
  }
  return { success: false, error: 'No image or pngpaste failed', suggestion: 'brew install pngpaste' };
}

function captureImageLinux(filepath: string): CaptureResult {
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

function formatImageOutput(result: CaptureResult): Record<string, unknown> {
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

// ============================================================================
// Video Capture Functions
// ============================================================================

function pasteVideo(): CaptureResult {
  const platform = process.platform;
  const tempDir = getTempDir();

  let result: CaptureResult;

  switch (platform) {
    case 'win32':
      result = captureVideoWindows(tempDir);
      break;
    case 'darwin':
      result = captureVideoMacOS(tempDir);
      break;
    case 'linux':
      result = captureVideoLinux(tempDir);
      break;
    default:
      result = {
        success: false,
        error: `Unsupported platform: ${platform}`,
        suggestion: 'This tool supports Windows, macOS, and Linux only'
      };
  }

  result.platform = platform;
  result.tempDir = tempDir;
  return result;
}

function captureVideoWindows(destDir: string): CaptureResult {
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms

# Try to get file drop list from clipboard (copied files)
$files = [System.Windows.Forms.Clipboard]::GetFileDropList()

if ($files -and $files.Count -gt 0) {
    # Return first video file found in clipboard
    foreach ($file in $files) {
        $ext = [System.IO.Path]::GetExtension($file).ToLower()
        if ($ext -in @('.mp4', '.webm', '.mov', '.avi', '.mkv', '.gif')) {
            Write-Output "FILE:$file"
            exit 0
        }
    }
}

# Fallback: Check for recent Snipping Tool videos
$snipFolder = [System.IO.Path]::Combine($env:USERPROFILE, 'Videos', 'Screen Recordings')
if (Test-Path $snipFolder) {
    $recentVideo = Get-ChildItem -Path $snipFolder -Filter "*.mp4" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($recentVideo) {
        $age = (Get-Date) - $recentVideo.LastWriteTime
        if ($age.TotalMinutes -le 5) {
            Write-Output "SNIP:$($recentVideo.FullName)"
            exit 0
        }
    }
}

# Also check Screenshots folder (some versions save there)
$screenshotFolder = [System.IO.Path]::Combine($env:USERPROFILE, 'Pictures', 'Screenshots')
if (Test-Path $screenshotFolder) {
    $recentVideo = Get-ChildItem -Path $screenshotFolder -Filter "*.mp4" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($recentVideo) {
        $age = (Get-Date) - $recentVideo.LastWriteTime
        if ($age.TotalMinutes -le 5) {
            Write-Output "SNIP:$($recentVideo.FullName)"
            exit 0
        }
    }
}

# Also check Videos folder root
$videosFolder = [System.IO.Path]::Combine($env:USERPROFILE, 'Videos')
if (Test-Path $videosFolder) {
    $recentVideo = Get-ChildItem -Path $videosFolder -Filter "*.mp4" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($recentVideo) {
        $age = (Get-Date) - $recentVideo.LastWriteTime
        if ($age.TotalMinutes -le 5) {
            Write-Output "SNIP:$($recentVideo.FullName)"
            exit 0
        }
    }
}

Write-Error "NO_VIDEO_FOUND"
exit 1
  `.trim();

  try {
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 10000
      }
    );

    if (result.error) {
      return { success: false, error: `PowerShell error: ${result.error.message}` };
    }

    if (result.stderr?.includes('NO_VIDEO_FOUND')) {
      return {
        success: false,
        error: 'No video found in clipboard or recent recordings.',
        suggestion: 'Copy a video file or record with Snipping Tool (Win+Shift+R) first.'
      };
    }

    if (result.status !== 0) {
      const errorMsg = result.stderr || result.stdout || 'Unknown PowerShell error';
      return { success: false, error: `Failed to capture: ${errorMsg.trim()}` };
    }

    const output = result.stdout.trim();
    let sourcePath: string | null = null;
    let sourceType: 'clipboard' | 'snipping-tool' = 'clipboard';

    if (output.startsWith('FILE:')) {
      sourcePath = output.substring(5);
      sourceType = 'clipboard';
    } else if (output.startsWith('SNIP:')) {
      sourcePath = output.substring(5);
      sourceType = 'snipping-tool';
    }

    if (!sourcePath || !existsSync(sourcePath)) {
      return { success: false, error: 'Video file not found or inaccessible' };
    }

    // Copy video to temp directory
    const ext = extname(sourcePath);
    const destFilename = generateVideoFilename(ext);
    const destPath = join(destDir, destFilename);

    copyFileSync(sourcePath, destPath);

    if (existsSync(destPath)) {
      return {
        success: true,
        path: destPath,
        sourcePath: sourcePath,
        sourceType: sourceType
      };
    }

    return { success: false, error: 'Failed to copy video file' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Windows video capture error: ${message}` };
  }
}

function captureVideoMacOS(destDir: string): CaptureResult {
  const appleScript = `
use scripting additions

set thePath to ""

try
    set theFiles to the clipboard as «class furl»
    set thePath to POSIX path of theFiles
on error
    try
        set theFiles to the clipboard as list
        if (count of theFiles) > 0 then
            set thePath to POSIX path of (item 1 of theFiles)
        end if
    end try
end try

if thePath is not "" then
    return thePath
else
    return "NO_FILE"
end if
  `.trim();

  try {
    const result = spawnSync('osascript', ['-e', appleScript], {
      encoding: 'utf-8',
      timeout: 5000
    });

    if (result.stdout && result.stdout.trim() !== 'NO_FILE') {
      const sourcePath = result.stdout.trim();

      if (!isVideoFile(sourcePath)) {
        return {
          success: false,
          error: 'Clipboard does not contain a video file',
          suggestion: 'Copy a video file (.mp4, .mov, .webm) to clipboard first'
        };
      }

      if (!existsSync(sourcePath)) {
        return { success: false, error: 'Video file not found' };
      }

      // Copy video to temp directory
      const ext = extname(sourcePath);
      const destFilename = generateVideoFilename(ext);
      const destPath = join(destDir, destFilename);

      copyFileSync(sourcePath, destPath);

      if (existsSync(destPath)) {
        return {
          success: true,
          path: destPath,
          sourcePath: sourcePath,
          sourceType: 'clipboard'
        };
      }
    }

    // Fallback: Check for recent screen recordings
    const recentResult = findRecentVideoInFolders(
      [join(homedir(), 'Movies'), join(homedir(), 'Desktop')],
      destDir
    );

    if (recentResult) {
      return recentResult;
    }

    return {
      success: false,
      error: 'No video in clipboard or recent recordings',
      suggestion: 'Copy a video file or use Cmd+Shift+5 to record screen'
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `macOS video capture error: ${message}` };
  }
}

function captureVideoLinux(destDir: string): CaptureResult {
  try {
    // Check if xclip is available
    const whichResult = spawnSync('which', ['xclip'], { encoding: 'utf-8' });
    if (whichResult.status !== 0) {
      return {
        success: false,
        error: 'xclip is not installed',
        suggestion: 'Install with: sudo apt install xclip'
      };
    }

    // Try to get file path from clipboard
    const result = spawnSync(
      'xclip',
      ['-selection', 'clipboard', '-t', 'text/uri-list', '-o'],
      { encoding: 'utf-8', timeout: 5000 }
    );

    if (result.status === 0 && result.stdout) {
      const uri = result.stdout.trim();
      let sourcePath = uri;

      // Convert file:// URI to path
      if (uri.startsWith('file://')) {
        sourcePath = decodeURIComponent(uri.replace('file://', ''));
      }

      if (isVideoFile(sourcePath) && existsSync(sourcePath)) {
        const ext = extname(sourcePath);
        const destFilename = generateVideoFilename(ext);
        const destPath = join(destDir, destFilename);

        copyFileSync(sourcePath, destPath);

        if (existsSync(destPath)) {
          return {
            success: true,
            path: destPath,
            sourcePath: sourcePath,
            sourceType: 'clipboard'
          };
        }
      }
    }

    // Fallback: Check common video folders for recent recordings
    const recentResult = findRecentVideoInFolders(
      [
        join(homedir(), 'Videos'),
        join(homedir(), 'Screencasts'),
        join(homedir(), 'Desktop')
      ],
      destDir
    );

    if (recentResult) {
      return recentResult;
    }

    return {
      success: false,
      error: 'No video in clipboard or recent recordings',
      suggestion: 'Copy a video file or use a screen recorder first'
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Linux video capture error: ${message}` };
  }
}

function formatVideoOutput(result: CaptureResult): Record<string, unknown> {
  if (result.success && result.path) {
    const stats = statSync(result.path);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    const ext = extname(result.path).toLowerCase();

    return {
      success: true,
      message: `Video captured from ${result.sourceType}`,
      path: result.path,
      sourcePath: result.sourcePath,
      sourceType: result.sourceType,
      size: `${sizeMB} MB`,
      format: ext.substring(1).toUpperCase(),
      platform: result.platform
    };
  }

  return {
    success: false,
    error: result.error,
    suggestion: result.suggestion || 'Record a video with Snipping Tool (Win+Shift+R) or copy a video file to clipboard',
    platform: result.platform
  };
}