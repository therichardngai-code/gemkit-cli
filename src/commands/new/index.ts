/**
 * New command - Create a new GemKit project
 */

import type { CAC } from 'cac';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getLatestRelease } from '../../domains/github/index.js';
import { downloadRelease } from '../../domains/github/download.js';
import { extractTarGz } from '../../services/archive.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';

export function registerNewCommand(cli: CAC): void {
  cli
    .command('new <name>', 'Create a new project from starter kit')
    .action(async (name: string) => {
      const destDir = join(process.cwd(), name);

      if (existsSync(destDir)) {
        console.log();
        logger.error(`Directory already exists: ${name}`);
        console.log();
        process.exit(1);
      }

      console.log();
      console.log(pc.bold(brand.geminiPurple('Creating New Project')));
      console.log();

      logger.info(`Name: ${brand.primary(name)}`);

      const latest = await getLatestRelease();
      if (!latest) {
        logger.error('Failed to fetch latest starter kit.');
        console.log();
        process.exit(1);
      }

      logger.info(`Fetching latest starter kit (v${latest.version})...`);

      const tarPath = await downloadRelease(latest);
      const result = await extractTarGz({
        source: tarPath,
        destination: destDir,
        strip: 1,
      });

      if (result.success) {
        console.log();
        logger.success(`Project ${brand.primary(name)} created successfully!`);
        console.log(`\nNext steps:\n  cd ${brand.primary(name)}\n  gk init\n`);
      } else {
        logger.error(`Failed to create project: ${result.error}`);
        console.log();
      }
    });
}
