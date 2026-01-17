/**
 * Agent Office domain exports
 * Gamified visualization for multi-agent workflows
 */

// Types
export * from './types.js';

// State machine
export {
  createInitialState,
  isValidTransition,
  transitionAgent,
  processEvent,
} from './state-machine.js';

// Utilities
export {
  getIconForRole,
  formatDisplayName,
} from './icons.js';

// Session bridge
export {
  sessionToOfficeState,
  agentToOfficeAgent,
  agentToInboxItem,
  isOrchestrator,
} from './session-bridge.js';

// Documents
export {
  scanPlanDocuments,
  groupDocumentsByType,
} from './documents-scanner.js';

// Event system
export { OfficeEventEmitter } from './event-emitter.js';

// File watcher
export { SessionFileWatcher, type FileWatcherOptions } from './file-watcher.js';

// Renderers
export { WebDashboard, startWebDashboard, type WebDashboardOptions } from './renderer/web.js';
