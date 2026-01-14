/**
 * Session path utilities
 * Re-exports from utils/paths.ts for backwards compatibility
 * Aligned with gk-session-manager.cjs
 */

export {
  GEMKIT_PROJECTS_DIR,
  getProjectDataDir,
  getSessionPath,
  getProjectPath,
  sanitizeProjectPath
} from '../../utils/paths.js';
