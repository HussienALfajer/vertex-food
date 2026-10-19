import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Config = { extends?: string; compilerOptions?: Record<string, unknown> };

function readJson(path: string): Config & Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
}

describe('shared tsconfig', () => {
  it('base keeps strict mode and the stricter checks on', () => {
    const { compilerOptions } = readJson('tsconfig/base.json');
    expect(compilerOptions).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      noFallthroughCasesInSwitch: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      verbatimModuleSyntax: true,
    });
  });

  it('node extends base and resolves modules as Node does', () => {
    const config = readJson('tsconfig/node.json');
    expect(config.extends).toBe('./base.json');
    expect(config.compilerOptions).toMatchObject({
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
    });
  });

  it('react extends base and resolves modules as a bundler does, with the DOM and JSX', () => {
    const config = readJson('tsconfig/react.json');
    expect(config.extends).toBe('./base.json');
    expect(config.compilerOptions).toMatchObject({
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2024', 'DOM', 'DOM.Iterable'],
      jsx: 'react-jsx',
      noEmit: true,
    });
  });

  it('expo extends base and resolves modules as Metro does, with React Native first', () => {
    const config = readJson('tsconfig/expo.json');
    expect(config.extends).toBe('./base.json');
    expect(config.compilerOptions).toMatchObject({
      module: 'Preserve',
      moduleResolution: 'Bundler',
      customConditions: ['react-native'],
      jsx: 'react-jsx',
      noEmit: true,
    });
  });

  it('nest extends node with the legacy decorators and no decorator metadata', () => {
    const config = readJson('tsconfig/nest.json');
    expect(config.extends).toBe('./node.json');
    // Without emitted metadata, injection is explicit (@Inject(token)) and behaves the same in the
    // build and under Vitest, whose transform may not emit it.
    expect(config.compilerOptions).toEqual({ experimentalDecorators: true });
  });
});

describe('shared biome config', () => {
  it('lints with the recommended preset and refuses console.log', () => {
    const config = readJson('biome.json') as { linter?: Record<string, unknown> };
    expect(config.linter).toMatchObject({
      enabled: true,
      rules: {
        preset: 'recommended',
        suspicious: { noConsole: { level: 'error', options: { allow: ['error', 'warn'] } } },
      },
    });
  });
});
