import { createCommandRegistry } from '../registry.js';
import { recordLocalEvents } from './audit.js';
import { networkCheck } from './sync.js';

export * from './audit.js';
export * from './sync.js';

/**
 * Every command of this release (one file per owning module). S09 onward add theirs; a command's
 * old versions stay until no supported app sends them.
 */
export const commandRegistry = createCommandRegistry([networkCheck, recordLocalEvents]);
