/**
 * Command registry for GemKit CLI
 */

import type { CAC } from 'cac';

import { registerInitCommand } from './init/index.js';
import { registerUpdateCommand } from './update/index.js';
import { registerVersionsCommand } from './versions/index.js';
import { registerDoctorCommand } from './doctor/index.js';
import { registerConfigCommand } from './config/index.js';
import { registerCacheCommand } from './cache/index.js';
import { registerNewCommand } from './new/index.js';
import { registerAgentCommand } from './agent/index.js';
import { registerSessionCommand } from './session/index.js';
import { registerPlanCommand } from './plan/index.js';
import { registerTokensCommand } from './tokens/index.js';
import { registerExtensionCommand } from './extension/index.js';
import { registerCatalogCommand } from './catalog/index.js';
import { registerPasteImageCommand } from './paste-image/index.js';
import { registerConvertCommand } from './convert/index.js';

export function registerCommands(cli: CAC): void {
  registerInitCommand(cli);
  registerUpdateCommand(cli);
  registerVersionsCommand(cli);
  registerDoctorCommand(cli);
  registerConfigCommand(cli);
  registerCacheCommand(cli);
  registerNewCommand(cli);
  registerAgentCommand(cli);
  registerSessionCommand(cli);
  registerPlanCommand(cli);
  registerTokensCommand(cli);
  registerExtensionCommand(cli);
  registerCatalogCommand(cli);
  registerPasteImageCommand(cli);
  registerConvertCommand(cli);
}