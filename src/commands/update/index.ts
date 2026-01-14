/**
 * Update command - Update GemKit to latest version
 */

import type { CAC } from 'cac';
import { getLatestRelease } from '../../domains/github/releases.js';
import { downloadRelease } from '../../domains/github/download.js';
import { extractTarGz } from '../../services/archive.js';
import { syncFiles } from '../../domains/installation/file-sync.js';
import { loadMetadata, saveMetadata } from '../../domains/installation/metadata.js';
import { getLocalGeminiDir } from '../../utils/paths.js';
import { logger } from '../../services/logger.js';
import { colors } from '../../utils/colors.js';

export function registerUpdateCommand(cli: CAC): void {
  cli
    .command('update', 'Update GemKit to latest version')
    .option('-f, --force', 'Force update and overwrite modified files')
    .option('--no-backup', 'Disable backup before update')
    .action(async (options: { force?: boolean; backup?: boolean }) => {
      const metadata = loadMetadata();
      if (!metadata) {
        logger.error('GemKit not initialized. Run "gk init" first.');
        process.exit(1);
      }

      logger.info('Checking for updates...');
      const latest = await getLatestRelease();

      if (!latest) {
        logger.error('Failed to check for updates.');
        process.exit(1);
      }

      if (latest.version === metadata.version && !options.force) {
        logger.success(`GemKit is already up to date (v${metadata.version})`);
        return;
      }

      logger.info(`Updating from v${metadata.version} to v${latest.version}...`);

      // Download and extract to temp
      const tarPath = await downloadRelease(latest);
      const extractDir = getLocalGeminiDir(); // In MVP, we sync directly for simplicity

      const result = await extractTarGz({
        source: tarPath,
        destination: extractDir,
        strip: 1,
      });

      if (!result.success) {
        logger.error(`Update failed: ${result.error}`);
        process.exit(1);
      }

      // Update metadata
      const newMetadata = {
        ...metadata,
        version: latest.version,
        installedAt: new Date().toISOString(),
        installedFiles: result.extractedFiles,
      };
      saveMetadata(newMetadata);

      logger.success(`GemKit updated to v${latest.version} successfully!`);
    });
}
