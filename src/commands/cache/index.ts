/**
 * Cache command - Manage release cache
 */

import type { CAC } from 'cac';
import { clearCache, getCacheStats } from '../../domains/cache/manager.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';

export function registerCacheCommand(cli: CAC): void {
  const cache = cli.command('cache <subcommand>', 'Cache management');

  // Subcommands
  cache.example('gk cache stats      # Show cache statistics');
  cache.example('gk cache clear      # Clear all cache');

  cache.action(async (subcommand: string) => {
    const sub = subcommand || 'stats';

    switch (sub) {
      case 'stats':
        await handleStats();
        break;
      case 'clear':
        await handleClear();
        break;
      default:
        console.log();
        logger.error(`Unknown subcommand: ${sub}`);
        console.log();
        process.exit(1);
    }
  });
}

async function handleStats() {
  const stats = getCacheStats();
  console.log();
  console.log(pc.bold(brand.geminiPurple('Cache Statistics')));
  console.log();
  console.log(`  ${brand.dim('Entries:')} ${brand.primary(String(stats.entries))}`);
  console.log(`  ${brand.dim('Size:')}    ${brand.primary((stats.size / 1024).toFixed(2))} KB`);
  console.log();
}

async function handleClear() {
  const count = clearCache();
  console.log();
  logger.success(`Cleared ${brand.success(String(count))} cache entries.`);
  console.log();
}
