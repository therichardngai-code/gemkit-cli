/**
 * Config command - View and edit configuration
 *
 * Subcommands organized with custom help display.
 */

import type { CAC } from 'cac';
import { loadConfig, getConfigValue, setConfigValue, resetConfig } from '../../domains/config/manager.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';

// ═══════════════════════════════════════════════════════════════════════════
// HELP FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function showMainHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('Configuration Management')));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk config')} <subcommand> [options]`);
  console.log();
  console.log('Subcommands:');
  console.log(`  ${brand.primary('list')}              Show all config (default)`);
  console.log(`  ${brand.primary('get')} <key>         Get config value`);
  console.log(`  ${brand.primary('set')} <key> <val>   Set config value`);
  console.log(`  ${brand.primary('reset')}             Reset to defaults`);
  console.log();
  console.log('Options:');
  console.log(`  ${brand.dim('--json')}            [list] Output as JSON`);
  console.log();
  console.log('Examples:');
  console.log(`  ${brand.dim('gk config list')}`);
  console.log(`  ${brand.dim('gk config get spawn.defaultModel')}`);
  console.log(`  ${brand.dim('gk config set spawn.music true')}`);
  console.log(`  ${brand.dim('gk config reset')}`);
  console.log();
}

export function registerConfigCommand(cli: CAC): void {
  cli
    .command('config [subcommand] [key] [value]', 'Configuration management (list, get, set, reset)')
    .alias('c')
    .option('--json', '[list] Output as JSON')
    .action(async (subcommand: string | undefined, key: string | undefined, value: string | undefined, options: { json?: boolean }) => {
      const sub = subcommand || 'list';

      switch (sub) {
        case 'list':
          await handleList(options);
          break;
        case 'get':
          if (!key) {
            console.log();
            logger.error('Config key required');
            console.log(brand.dim('Usage: gk config get <key>'));
            console.log();
            process.exit(1);
          }
          await handleGet(key);
          break;
        case 'set':
          if (!key || value === undefined) {
            console.log();
            logger.error('Config key and value required');
            console.log(brand.dim('Usage: gk config set <key> <value>'));
            console.log();
            process.exit(1);
          }
          await handleSet(key, value);
          break;
        case 'reset':
          await handleReset();
          break;
        default:
          showMainHelp();
      }
    });
}

async function handleList(options: { json?: boolean }) {
  const c = loadConfig();

  if (options.json) {
    console.log(JSON.stringify(c, null, 2));
    return;
  }

  console.log();
  console.log(pc.bold(brand.geminiPurple('GemKit Configuration')));
  console.log();
  console.log(JSON.stringify(c, null, 2));
  console.log();
}

async function handleGet(key: string) {
  const value = getConfigValue(key);
  if (value === undefined) {
    console.log();
    logger.error(`Config key not found: ${key}`);
    console.log();
    return;
  }
  console.log(value);
}

async function handleSet(key: string, value: string) {
  // Basic type conversion
  let typedValue: any = value;
  if (value === 'true') typedValue = true;
  else if (value === 'false') typedValue = false;
  else if (!isNaN(Number(value))) typedValue = Number(value);

  try {
    setConfigValue(key, typedValue);
    console.log();
    logger.success(`Config updated: ${brand.primary(key)} = ${brand.success(String(typedValue))}`);
    console.log();
  } catch (error) {
    console.log();
    logger.error(`Failed to set config: ${error instanceof Error ? error.message : String(error)}`);
    console.log();
  }
}

async function handleReset() {
  resetConfig();
  console.log();
  logger.success('Configuration reset to defaults.');
  console.log();
}
