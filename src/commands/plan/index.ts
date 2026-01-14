/**
 * Plan command - list, status, create, set, info
 * Replaces: gk-set-active-plan.cjs (set), get_plan_info.js (info)
 *
 * Subcommands organized with custom help display.
 */

import type { CAC } from 'cac';
import { listPlans, createPlan, setActivePlan, getPlanInfo } from '../../domains/plan/index.js';
import { getActivePlan, getSuggestedPlan, getActiveGkSessionId, getProjectDir, readEnv } from '../../domains/session/env.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';

// ═══════════════════════════════════════════════════════════════════════════
// HELP FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function showMainHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('Plan Management')));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk plan')} <subcommand> [options]`);
  console.log();
  console.log('Subcommands:');
  console.log(`  ${brand.primary('list')}              List all plans (default)`);
  console.log(`  ${brand.primary('status')}            Show active plan status`);
  console.log(`  ${brand.primary('create')} <name>     Create new plan`);
  console.log(`  ${brand.primary('set')} <name>        Set active plan`);
  console.log(`  ${brand.primary('info')}              Get plan info from .env`);
  console.log();
  console.log('Options:');
  console.log(`  ${brand.dim('--json')}            Output as JSON`);
  console.log(`  ${brand.dim('-a, --active')}      [info] Show only ACTIVE_PLAN value`);
  console.log(`  ${brand.dim('-s, --suggested')}   [info] Show only SUGGESTED_PLAN value`);
  console.log(`  ${brand.dim('-f, --format')}      [info] Show only PLAN_DATE_FORMAT value`);
  console.log();
  console.log('Examples:');
  console.log(`  ${brand.dim('gk plan list')}`);
  console.log(`  ${brand.dim('gk plan create my-feature')}`);
  console.log(`  ${brand.dim('gk plan set my-feature')}`);
  console.log(`  ${brand.dim('gk plan info --active')}`);
  console.log();
}

export function registerPlanCommand(cli: CAC): void {
  cli
    .command('plan [subcommand] [name]', 'Plan management (list, status, create, set, info)')
    .alias('p')
    .option('--json', '[all] Output as JSON')
    .option('-a, --active', '[info] Show only ACTIVE_PLAN value')
    .option('-s, --suggested', '[info] Show only SUGGESTED_PLAN value')
    .option('-f, --format', '[info] Show only PLAN_DATE_FORMAT value')
    .action(async (subcommand: string | undefined, name: string | undefined, options: {
      json?: boolean;
      active?: boolean;
      suggested?: boolean;
      format?: boolean;
    }) => {
      const sub = subcommand || 'list';

      switch (sub) {
        case 'list':
          await handleList(options);
          break;
        case 'status':
          await handleStatus(options);
          break;
        case 'create':
          if (!name) {
            console.log();
            logger.error('Plan name required');
            console.log(brand.dim('Usage: gk plan create <name>'));
            console.log();
            process.exit(1);
          }
          await handleCreate(name);
          break;
        case 'set':
          if (!name) {
            console.log();
            logger.error('Plan name required');
            console.log(brand.dim('Usage: gk plan set <name>'));
            console.log();
            process.exit(1);
          }
          await handleSet(name);
          break;
        case 'info':
          await handleInfo(options);
          break;
        default:
          showMainHelp();
      }
    });
}

async function handleList(options: { json?: boolean }) {
  const plans = listPlans();

  if (options.json) {
    console.log(JSON.stringify(plans, null, 2));
    return;
  }

  console.log();
  console.log(pc.bold(brand.geminiPurple('Project Plans')));
  console.log();

  if (plans.length === 0) {
    logger.info('No plans found. Create one with "gk plan create <name>".');
    console.log();
    return;
  }

  for (const p of plans) {
    const icon = p.isActive ? brand.success('→') : brand.dim('○');
    const activeMarker = p.isActive ? brand.success(' (active)') : '';
    console.log(`  ${icon} ${brand.primary(p.name)}${activeMarker}`);
    console.log(`    ${brand.dim('Created:')} ${brand.dim(new Date(p.createdAt).toLocaleDateString())}`);
  }
  console.log();
}

async function handleStatus(options: { json?: boolean }) {
  const activeName = getActivePlan();

  if (!activeName) {
    if (options.json) {
      console.log(JSON.stringify({ active: false }, null, 2));
    } else {
      console.log();
      logger.info('No active plan set.');
      console.log();
    }
    return;
  }

  const info = getPlanInfo(activeName);
  if (options.json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  console.log();
  console.log(ui.line());
  console.log(pc.bold(brand.geminiPurple('Active Plan')));
  console.log(ui.line());
  console.log();
  console.log(`  ${brand.primary(activeName)}`);
  console.log();
}

async function handleCreate(name: string) {
  try {
    const newPlan = createPlan(name);
    console.log();
    logger.success(`Plan created: ${brand.primary(name)}`);
    logger.info(`Path: ${brand.dim(newPlan.path)}`);

    // Auto-activate
    setActivePlan(name);
    logger.info('Set as active plan.');
    console.log();
  } catch (error) {
    console.log();
    logger.error(`Failed to create plan: ${error instanceof Error ? error.message : String(error)}`);
    console.log();
  }
}

async function handleSet(name: string) {
  const plans = listPlans();
  const exists = plans.some(p => p.name === name);

  if (!exists) {
    console.log();
    logger.error(`Plan not found: ${name}`);
    console.log();
    return;
  }

  const success = setActivePlan(name);
  if (!success) {
    console.log();
    logger.error('Failed to update session or env file');
    console.log();
    return;
  }

  // Get session info for display
  const gkSessionId = getActiveGkSessionId();
  console.log();
  if (gkSessionId) {
    logger.success(`Session ${gkSessionId.slice(0, 20)}...: activePlan set to: ${brand.primary(name)}`);
  }
  logger.info(`Environment updated: ACTIVE_PLAN = ${name}`);
  console.log();
  logger.success(`Active plan set to: ${brand.primary(name)}`);
  console.log();
}

/**
 * Handle plan info - Get plan information from .env
 * Replaces: get_plan_info.js
 */
async function handleInfo(options: {
  json?: boolean;
  active?: boolean;
  suggested?: boolean;
  format?: boolean;
}) {
  const env = readEnv();

  const info = {
    activePlan: env.ACTIVE_PLAN || null,
    suggestedPlan: env.SUGGESTED_PLAN || null,
    planDateFormat: env.PLAN_DATE_FORMAT || null,
    gkSessionId: env.ACTIVE_GK_SESSION_ID || null,
    projectDir: env.PROJECT_DIR || null
  };

  // Handle single-field requests
  if (options.active) {
    if (options.json) {
      console.log(JSON.stringify({ activePlan: info.activePlan }));
    } else {
      console.log(info.activePlan || '');
    }
    return;
  }

  if (options.suggested) {
    if (options.json) {
      console.log(JSON.stringify({ suggestedPlan: info.suggestedPlan }));
    } else {
      console.log(info.suggestedPlan || '');
    }
    return;
  }

  if (options.format) {
    if (options.json) {
      console.log(JSON.stringify({ planDateFormat: info.planDateFormat }));
    } else {
      console.log(info.planDateFormat || '');
    }
    return;
  }

  // Full output
  if (options.json) {
    console.log(JSON.stringify({
      activePlan: info.activePlan,
      suggestedPlan: info.suggestedPlan,
      planDateFormat: info.planDateFormat,
      context: {
        gkSessionId: info.gkSessionId,
        projectDir: info.projectDir
      }
    }, null, 2));
  } else {
    console.log();
    console.log(ui.line());
    console.log(pc.bold(brand.geminiPurple('Plan Information')));
    console.log(ui.line());
    console.log();
    console.log(`  ${brand.dim('Active Plan:')}      ${info.activePlan || brand.dim('(not set)')}`);
    console.log(`  ${brand.dim('Suggested Plan:')}   ${info.suggestedPlan || brand.dim('(not set)')}`);
    console.log(`  ${brand.dim('Date Format:')}      ${info.planDateFormat || brand.dim('(not set)')}`);
    console.log();
    console.log(ui.line());
    const shortSession = info.gkSessionId ? info.gkSessionId.substring(0, 25) + '...' : brand.dim('(no session)');
    console.log(`  ${brand.dim('Session:')}          ${shortSession}`);
    console.log(`  ${brand.dim('Project:')}          ${info.projectDir || brand.dim('(unknown)')}`);
    console.log();
  }
}
