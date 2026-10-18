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
