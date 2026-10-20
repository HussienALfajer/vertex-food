/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// native-error-reports.ts deep-imports React Native's internal ExceptionsManager: no supported API
// intercepts what reaches native crash reports (audit CQ-01). Vitest cannot run React Native, so
// this reads the module's source and fails as soon as an upgrade moves or renames what it uses.
const require = createRequire(import.meta.url);
const checkedVersion = '0.88.0';

describe('React Native ExceptionsManager (internal)', () => {
  it('was rechecked for the installed React Native', () => {
    // On an Expo SDK upgrade: recheck native-error-reports.ts on a development build, then update.
    expect(require('react-native/package.json').version).toBe(checkedVersion);
  });

  it('still exports unstable_setExceptionDecorator on its default export', () => {
    const source = readFileSync(
      require.resolve('react-native/Libraries/Core/ExceptionsManager'),
      'utf8',
    );
    expect(source).toMatch(/function unstable_setExceptionDecorator\(/);
    expect(source).toMatch(/const ExceptionsManager = \{[^}]*unstable_setExceptionDecorator,/s);
    expect(source).toMatch(/export default ExceptionsManager;/);
  });
});
