import { configDefaults, defineConfig } from 'vitest/config';

// The hub's real-port scenarios run on real time with real HTTPS and several encrypted databases:
// they run alone, after every other file (`groupOrder`), so their timers and the other files'
// databases never compete for the CPU (CI's runners have four cores).
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
          exclude: [...configDefaults.exclude, scenarios],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: { name: 'hub-scenarios', include: [scenarios], sequence: { groupOrder: 1 } },
      },
    ],
  },
});
