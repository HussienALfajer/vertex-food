import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The main process's tests that load native code or speak TLS (the encrypted database, the hub's
// storage, LAN server and mutual TLS), run again in Electron's own Node (`ELECTRON_RUN_AS_NODE`):
// its BoringSSL and its native module ABI, as the packaged app runs them (spec S04 "Tests").
// Vitest's workers inherit the runtime. Extra arguments go to Vitest.

const require = createRequire(import.meta.url);
/** In Node, the `electron` package answers the path of its binary. */
const electron = require('electron');
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const files = [
  'electron/local-db.test.ts',
  'electron/hub-store.test.ts',
  'electron/hub-scenarios.test.ts',
];

const child = spawn(electron, [vitest, 'run', ...files, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VERTEX_FOOD_ELECTRON_RUNTIME: '1' },
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
