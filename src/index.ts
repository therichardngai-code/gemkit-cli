#!/usr/bin/env node

/**
 * GemKit CLI Entry Point
 */

import { cac } from 'cac';
import { registerCommands } from './commands/index.js';
import { configureLogger } from './services/logger.js';
import { runAutoUpdateCheck } from './services/auto-update.js';
import { CLI_VERSION } from './commands/update/index.js';

const cli = cac('gk');

cli.version(CLI_VERSION);
cli.help();

// Global options
cli.option('--verbose', 'Enable verbose output');
cli.option('--json', 'Output as JSON');
cli.option('--no-update-check', 'Skip auto-update check');

// Configure logger based on global options
const parsed = cli.parse(process.argv, { run: false });
if (parsed.options.verbose) {
  configureLogger({ level: 'debug', verbose: true });
}
if (parsed.options.json) {
  configureLogger({ json: true });
}

// Register all commands
registerCommands(cli);

// Run auto-update check in background (unless disabled)
if (parsed.options.updateCheck !== false) {
  runAutoUpdateCheck().catch(() => {
    // Silently ignore update check errors
  });
}

// Parse and run
cli.parse();
