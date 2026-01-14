/**
 * Versions command - List available versions
 */

import type { CAC } from 'cac';
import { fetchReleases } from '../../domains/github/releases.js';
import { loadMetadata } from '../../domains/installation/metadata.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';

export function registerVersionsCommand(cli: CAC): void {
  cli
    .command('versions', 'List available GemKit versions')
    .alias('v')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const metadata = loadMetadata();
      const releases = await fetchReleases();

      if (options.json) {
        console.log(JSON.stringify({
          current: metadata?.version || null,
          available: releases
        }, null, 2));
        return;
      }

      console.log();
      console.log(pc.bold(brand.geminiPurple('GemKit Versions')));
      console.log();
      
      if (metadata) {
        console.log(`  ${brand.dim('Current:')}   ${brand.success(metadata.version)}`);
      } else {
        console.log(`  ${brand.dim('Current:')}   ${brand.dim('Not installed')}`);
      }

      console.log();
      console.log(`  ${pc.bold('Available Releases:')}`);
      for (const release of releases) {
        const marker = release.version === metadata?.version ? brand.success(' (current)') : '';
        console.log(`  - ${brand.primary(release.version)}${marker}`);
      }
      console.log();
    });
}
