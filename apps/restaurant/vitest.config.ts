import { configDefaults, defineConfig } from 'vitest/config';

// Three groups, one after the other (`groupOrder`), so the files that time the encrypted database
// never compete with the rest for the CPU (CI's runners have four cores):
// - every other file;
// - the encrypted database's own tests, which open, reopen and migrate several databases each and
//   passed 5 s when every file ran at once;
// - the hub's real-port scenarios, alone and last: real time with real HTTPS and several encrypted
//   databases, so their timers and the other files' databases never slow each other.
const encryptedDatabase = ['electron/local-db.test.ts', 'electron/local-store.test.ts'];
const scenarios = 'electron/hub-scenarios.test.ts';

export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'restaurant',
          include: ['electron/**/*.test.ts', 'src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...encryptedDatabase, scenarios],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: { name: 'local-db', include: encryptedDatabase, sequence: { groupOrder: 1 } },
      },
      {
        extends: true,
        test: { name: 'hub-scenarios', include: [scenarios], sequence: { groupOrder: 2 } },
      },
    ],
  },
});
