import type { CAC } from 'cac';
import { listAllSkills, listAgentProfiles } from '../../domains/agent/index.js';
import { logger } from '../../services/logger.js';
import { brand, ui, pc } from '../../utils/colors.js';

export function registerCatalogCommand(cli: CAC): void {
  const catalog = cli.command('catalog [subcommand]', 'Catalog of skills and agents');

  catalog.action(async (subcommand: string) => {
    const sub = subcommand || 'skills';

    switch (sub) {
      case 'skills':
        await handleSkills();
        break;
      case 'agents':
        await handleAgents();
        break;
      default:
        console.log();
        logger.error(`Unknown subcommand: ${sub}`);
        console.log();
        process.exit(1);
    }
  });
}

async function handleSkills() {
  const skills = listAllSkills();

  console.log();
  console.log(pc.bold(brand.geminiPurple('Available Skills')));
  console.log();

  if (skills.length === 0) {
    logger.info('  No skills found.');
    console.log();
    return;
  }

  for (const s of skills) {
    console.log(`  ${brand.success('✓')} ${brand.primary(s.name)}`);
  }
  console.log();
  console.log(brand.dim(`  Total: ${skills.length} skills`));
  console.log();
}

async function handleAgents() {
  const profiles = listAgentProfiles();

  console.log();
  console.log(pc.bold(brand.geminiPurple('Available Agent Profiles')));
  console.log();

  if (profiles.length === 0) {
    logger.info('  No agent profiles found.');
    console.log();
    return;
  }

  for (const p of profiles) {
    console.log(`  ${brand.success('●')} ${brand.primary(p.name)}`);
    console.log(`    ${brand.dim(p.description)}`);
  }
  console.log();
  console.log(brand.dim(`  Total: ${profiles.length} profiles`));
  console.log();
}
