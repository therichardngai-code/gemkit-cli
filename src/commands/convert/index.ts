/**
 * Convert command - Convert .claude resources to .gemini
 *
 * Types organized with custom help display.
 * All options apply to all types (skill/agent).
 */

import type { CAC } from 'cac';
import {
  listSkills,
  convertSkill,
  convertAllSkills,
  getConversionSummary,
  extensionExists,
  getSkillsDir,
  getExtensionsDir,
  listAgents,
  convertAgent,
  convertAllAgents,
  geminiAgentExists,
  getClaudeAgentsDir,
  getGeminiAgentsDir
} from '../../domains/convert/index.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';

// ═══════════════════════════════════════════════════════════════════════════
// HELP FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function showMainHelp(): void {
  console.log();
  console.log(pc.bold(brand.geminiPurple('Convert .claude to .gemini')));
  console.log();
  console.log('Usage:');
  console.log(`  ${brand.primary('gk convert')} <type> [name] [options]`);
  console.log();
  console.log('Types:');
  console.log(`  ${brand.primary('skill')} <name>      Convert a single skill to extension`);
  console.log(`  ${brand.primary('skills')}            Convert all skills to extensions`);
  console.log(`  ${brand.primary('agent')} <name>      Convert a single agent`);
  console.log(`  ${brand.primary('agents')}            Convert all agents`);
  console.log();
  console.log('Options:');
  console.log(`  ${brand.dim('--list')}            List available items`);
  console.log(`  ${brand.dim('--force')}           Overwrite existing items`);
  console.log(`  ${brand.dim('--dry-run')}         Show what would be done without changes`);
  console.log(`  ${brand.dim('--json')}            Output as JSON`);
  console.log();
  console.log('Examples:');
  console.log(`  ${brand.dim('gk convert skill --list')}`);
  console.log(`  ${brand.dim('gk convert skill my-skill')}`);
  console.log(`  ${brand.dim('gk convert skills --force')}`);
  console.log(`  ${brand.dim('gk convert agent --list')}`);
  console.log(`  ${brand.dim('gk convert agents --dry-run')}`);
  console.log();
}

export function registerConvertCommand(cli: CAC): void {
  cli
    .command('convert [type] [name]', 'Convert .claude to .gemini resources')
    .alias('cv')
    .option('--all', '[all] Convert all items')
    .option('--list', '[all] List available items')
    .option('--force', '[all] Overwrite existing items')
    .option('--dry-run', '[all] Show what would be done without making changes')
    .option('--json', '[all] Output as JSON')
    .action(async (
      type: string | undefined,
      name: string | undefined,
      options: {
        all?: boolean;
        list?: boolean;
        force?: boolean;
        dryRun?: boolean;
        json?: boolean;
      }
    ) => {
      if (!type) {
        showMainHelp();
        return;
      }

      // Handle skill/skills
      if (type === 'skill' || type === 'skills') {
        if (options.list) {
          await handleListSkills(options);
          return;
        }
        if (options.all || type === 'skills') {
          await handleConvertAllSkills(options);
          return;
        }
        if (!name) {
          console.log();
          logger.error('Skill name required');
          console.log(brand.dim('Usage: gk convert skill <name>'));
          console.log(brand.dim('       gk convert skill --list  (to see available skills)'));
          console.log(brand.dim('       gk convert skills        (to convert all)'));
          console.log();
          process.exit(1);
        }
        await handleConvertSingleSkill(name, options);
        return;
      }

      // Handle agent/agents
      if (type === 'agent' || type === 'agents') {
        if (options.list) {
          await handleListAgents(options);
          return;
        }
        if (options.all || type === 'agents') {
          await handleConvertAllAgents(options);
          return;
        }
        if (!name) {
          console.log();
          logger.error('Agent name required');
          console.log(brand.dim('Usage: gk convert agent <name>'));
          console.log(brand.dim('       gk convert agent --list  (to see available agents)'));
          console.log(brand.dim('       gk convert agents        (to convert all)'));
          console.log();
          process.exit(1);
        }
        await handleConvertSingleAgent(name, options);
        return;
      }

      // Unknown type
      showMainHelp();
    });
}

async function handleListSkills(options: { json?: boolean }) {
  const skills = listSkills();

  if (options.json) {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  console.log();
  console.log(pc.bold(brand.geminiPurple('Available Claude Skills')));
  console.log(brand.dim(`  Source: ${getSkillsDir()}`));
  console.log();

  if (skills.length === 0) {
    logger.info('No skills found in .claude/skills/');
    console.log();
    return;
  }

  for (const skill of skills) {
    const exists = extensionExists(skill.name);
    const statusIcon = exists ? brand.success('✓') : brand.dim('○');
    const statusText = exists ? brand.dim(' (converted)') : '';

    console.log(`  ${statusIcon} ${brand.primary(skill.name)}${statusText}`);
    if (skill.description) {
      const shortDesc = skill.description.length > 70
        ? skill.description.slice(0, 70) + '...'
        : skill.description;
      console.log(`    ${brand.dim(shortDesc)}`);
    }
  }

  console.log();
  console.log(brand.dim(`  Total: ${skills.length} skills`));
  console.log();
}

async function handleConvertSingleSkill(
  name: string,
  options: { force?: boolean; dryRun?: boolean; json?: boolean }
) {
  const result = convertSkill(name, {
    force: options.force,
    dryRun: options.dryRun
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log();

  if (result.errors.length > 0) {
    logger.error(`Failed to convert skill: ${name}`);
    for (const error of result.errors) {
      console.log(`  ${brand.error('✗')} ${error}`);
    }
    console.log();
    process.exit(1);
  }

  if (result.skipped.length > 0) {
    logger.warn(`Skipped skill: ${name}`);
    for (const skip of result.skipped) {
      console.log(`  ${brand.dim('○')} ${skip}`);
    }
    console.log();
    return;
  }

  if (options.dryRun) {
    logger.info(`[DRY RUN] Would convert skill: ${name}`);
    for (const item of result.created) {
      console.log(`  ${brand.dim('→')} ${item}`);
    }
    console.log();
    return;
  }

  logger.success(`Converted skill: ${brand.primary(name)}`);
  console.log();
  console.log(`  ${brand.dim('Created files:')}`);
  for (const item of result.created.slice(0, 5)) {
    const shortPath = item.replace(process.cwd(), '.');
    console.log(`  ${brand.success('+')} ${shortPath}`);
  }
  if (result.created.length > 5) {
    console.log(`  ${brand.dim(`... and ${result.created.length - 5} more`)}`);
  }
  console.log();
  console.log(brand.dim(`  Extension created at: ${getExtensionsDir()}/${name}`));
  console.log();
}

async function handleConvertAllSkills(
  options: { force?: boolean; dryRun?: boolean; json?: boolean }
) {
  const skills = listSkills();

  if (skills.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ results: [], summary: { total: 0, success: 0, skipped: 0, failed: 0 } }, null, 2));
    } else {
      console.log();
      logger.info('No skills found in .claude/skills/');
      console.log();
    }
    return;
  }

  const results = convertAllSkills({
    force: options.force,
    dryRun: options.dryRun
  });

  const summary = getConversionSummary(results);

  if (options.json) {
    console.log(JSON.stringify({ results, summary }, null, 2));
    return;
  }

  console.log();

  if (options.dryRun) {
    console.log(pc.bold(brand.geminiPurple('[DRY RUN] Skill Conversion Preview')));
  } else {
    console.log(pc.bold(brand.geminiPurple('Skill Conversion Results')));
  }
  console.log(ui.line());
  console.log();

  for (const result of results) {
    if (result.errors.length > 0) {
      console.log(`  ${brand.error('✗')} ${result.skill}`);
      for (const error of result.errors) {
        console.log(`    ${brand.dim(error)}`);
      }
    } else if (result.skipped.length > 0) {
      console.log(`  ${brand.dim('○')} ${result.skill} ${brand.dim('(skipped)')}`);
    } else if (result.success) {
      const prefix = options.dryRun ? brand.dim('→') : brand.success('✓');
      console.log(`  ${prefix} ${result.skill}`);
    }
  }

  console.log();
  console.log(ui.line());
  console.log();

  if (options.dryRun) {
    console.log(`  ${brand.dim('Would convert:')} ${summary.success} skills`);
    console.log(`  ${brand.dim('Would skip:')}    ${summary.skipped} skills`);
    console.log(`  ${brand.dim('Would fail:')}    ${summary.failed} skills`);
  } else {
    console.log(`  ${brand.success('Converted:')} ${summary.success}`);
    console.log(`  ${brand.dim('Skipped:')}   ${summary.skipped}`);
    console.log(`  ${brand.error('Failed:')}    ${summary.failed}`);
  }

  console.log();

  if (summary.skipped > 0 && !options.force) {
    logger.info('Use --force to overwrite existing extensions');
    console.log();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleListAgents(options: { json?: boolean }) {
  const agents = listAgents();

  if (options.json) {
    console.log(JSON.stringify(agents, null, 2));
    return;
  }

  console.log();
  console.log(pc.bold(brand.geminiPurple('Available Claude Agents')));
  console.log(brand.dim(`  Source: ${getClaudeAgentsDir()}`));
  console.log();

  if (agents.length === 0) {
    logger.info('No agents found in .claude/agents/');
    console.log();
    return;
  }

  for (const agent of agents) {
    const exists = geminiAgentExists(agent.name);
    const statusIcon = exists ? brand.success('✓') : brand.dim('○');
    const statusText = exists ? brand.dim(' (converted)') : '';

    console.log(`  ${statusIcon} ${brand.primary(agent.name)}${statusText}`);
    if (agent.model) {
      console.log(`    ${brand.dim('Model:')} ${agent.model}`);
    }
    if (agent.description) {
      const shortDesc = agent.description.length > 60
        ? agent.description.slice(0, 60) + '...'
        : agent.description;
      console.log(`    ${brand.dim(shortDesc)}`);
    }
  }

  console.log();
  console.log(brand.dim(`  Total: ${agents.length} agents`));
  console.log();
}

async function handleConvertSingleAgent(
  name: string,
  options: { force?: boolean; dryRun?: boolean; json?: boolean }
) {
  const result = convertAgent(name, {
    force: options.force,
    dryRun: options.dryRun
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log();

  if (result.errors.length > 0) {
    logger.error(`Failed to convert agent: ${name}`);
    for (const error of result.errors) {
      console.log(`  ${brand.error('✗')} ${error}`);
    }
    console.log();
    process.exit(1);
  }

  if (result.skipped.length > 0) {
    logger.warn(`Skipped agent: ${name}`);
    for (const skip of result.skipped) {
      console.log(`  ${brand.dim('○')} ${skip}`);
    }
    console.log();
    return;
  }

  if (options.dryRun) {
    logger.info(`[DRY RUN] Would convert agent: ${name}`);
    for (const item of result.created) {
      console.log(`  ${brand.dim('→')} ${item}`);
    }
    console.log();
    return;
  }

  logger.success(`Converted agent: ${brand.primary(name)}`);
  console.log();
  for (const item of result.created) {
    const shortPath = item.replace(process.cwd(), '.');
    console.log(`  ${brand.success('+')} ${shortPath}`);
  }
  console.log();
  console.log(brand.dim(`  Agent created at: ${getGeminiAgentsDir()}/${name}.md`));
  console.log();
}

async function handleConvertAllAgents(
  options: { force?: boolean; dryRun?: boolean; json?: boolean }
) {
  const agents = listAgents();

  if (agents.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ results: [], summary: { total: 0, success: 0, skipped: 0, failed: 0 } }, null, 2));
    } else {
      console.log();
      logger.info('No agents found in .claude/agents/');
      console.log();
    }
    return;
  }

  const results = convertAllAgents({
    force: options.force,
    dryRun: options.dryRun
  });

  const summary = getConversionSummary(results);

  if (options.json) {
    console.log(JSON.stringify({ results, summary }, null, 2));
    return;
  }

  console.log();

  if (options.dryRun) {
    console.log(pc.bold(brand.geminiPurple('[DRY RUN] Agent Conversion Preview')));
  } else {
    console.log(pc.bold(brand.geminiPurple('Agent Conversion Results')));
  }
  console.log(ui.line());
  console.log();

  for (const result of results) {
    if (result.errors.length > 0) {
      console.log(`  ${brand.error('✗')} ${result.skill}`);
      for (const error of result.errors) {
        console.log(`    ${brand.dim(error)}`);
      }
    } else if (result.skipped.length > 0) {
      console.log(`  ${brand.dim('○')} ${result.skill} ${brand.dim('(skipped)')}`);
    } else if (result.success) {
      const prefix = options.dryRun ? brand.dim('→') : brand.success('✓');
      console.log(`  ${prefix} ${result.skill}`);
    }
  }

  console.log();
  console.log(ui.line());
  console.log();

  if (options.dryRun) {
    console.log(`  ${brand.dim('Would convert:')} ${summary.success} agents`);
    console.log(`  ${brand.dim('Would skip:')}    ${summary.skipped} agents`);
    console.log(`  ${brand.dim('Would fail:')}    ${summary.failed} agents`);
  } else {
    console.log(`  ${brand.success('Converted:')} ${summary.success}`);
    console.log(`  ${brand.dim('Skipped:')}   ${summary.skipped}`);
    console.log(`  ${brand.error('Failed:')}    ${summary.failed}`);
  }

  console.log();

  if (summary.skipped > 0 && !options.force) {
    logger.info('Use --force to overwrite existing agents');
    console.log();
  }
}
