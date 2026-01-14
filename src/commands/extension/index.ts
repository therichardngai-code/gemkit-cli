/**
 * Extension command - Manage GemKit extensions
 */

import type { CAC } from 'cac';
import { existsSync, readdirSync } from 'fs';
import { getExtensionsDir } from '../../utils/paths.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';

export function registerExtensionCommand(cli: CAC): void {
  const extension = cli.command('extension <subcommand>', 'Extension management').alias('ext');

  // Subcommands
  extension.example('gk extension list   # List installed extensions');

  extension.action(async (subcommand: string) => {
    const sub = subcommand || 'list';

    switch (sub) {
      case 'list':
        await handleList();
        break;
      default:
        console.log();
        logger.error(`Unknown subcommand: ${sub}`);
        console.log();
        process.exit(1);
    }
  });
}

async function handleList() {
  const extDir = getExtensionsDir();

  if (!existsSync(extDir)) {
    console.log();
    logger.info('No extensions directory found.');
    console.log();
    return;
  }

  const extensions = readdirSync(extDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  if (extensions.length === 0) {
    console.log();
    logger.info('No extensions installed.');
    console.log();
    return;
  }

  console.log();
  console.log(pc.bold(brand.geminiPurple('Installed Extensions')));
  console.log();
  for (const e of extensions) {
    console.log(`  ${brand.success('✓')} ${brand.primary(e)}`);
  }
  console.log();
  console.log(brand.dim(`  Total: ${extensions.length} extensions`));
  console.log();
}
