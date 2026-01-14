/**
 * Archive extraction service for .tar.gz files
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { dirname } from 'path';
import * as tar from 'tar';

export interface ExtractOptions {
  source: string;
  destination: string;
  strip?: number;
  filter?: (path: string) => boolean;
}

export interface ExtractResult {
  success: boolean;
  extractedFiles: string[];
  error?: string;
}

/**
 * Extract a .tar.gz archive
 */
export async function extractTarGz(options: ExtractOptions): Promise<ExtractResult> {
  const { source, destination, strip = 1, filter } = options;
  const extractedFiles: string[] = [];

  if (!existsSync(source)) {
    return { success: false, extractedFiles: [], error: `Source file not found: ${source}` };
  }

  // Ensure destination exists
  if (!existsSync(destination)) {
    mkdirSync(destination, { recursive: true });
  }

  try {
    await pipeline(
      createReadStream(source),
      createGunzip(),
      tar.x({
        cwd: destination,
        strip,
        filter: (path: string) => {
          if (filter && !filter(path)) {
            return false;
          }
          extractedFiles.push(path);
          return true;
        },
      })
    );

    return { success: true, extractedFiles };
  } catch (error) {
    return {
      success: false,
      extractedFiles,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Simple file copy for non-archive files
 */
export async function copyFile(source: string, destination: string): Promise<void> {
  const destDir = dirname(destination);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  await pipeline(createReadStream(source), createWriteStream(destination));
}
