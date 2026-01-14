#!/usr/bin/env node

/**
 * GemKit CLI Entry Point
 */

import { cac } from 'cac';
import { registerCommands } from './commands/index.js';
import { configureLogger } from './services/logger.js';

const cli = cac('gk');

cli.version('0.1.0');
cli.help();

// Global options
cli.option('--verbose', 'Enable verbose output');
cli.option('--json', 'Output as JSON');

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

// Parse and run
cli.parse();
