import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Arabic-first RTL (ADR 0018, ADR 0020): layout uses logical properties only, so the screens mirror
// without per-direction rules. Moves to the packages/ui convention test with the design system.

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

const cssRules: [RegExp, string][] = [
  [/(?:margin|padding|border|inset)-(?:left|right)\b/, 'use margin-inline-*, padding-inline-*…'],
  [/(?:^|[\s;{])(?:left|right)\s*:/m, 'use inset-inline-start / inset-inline-end'],
  [/(?:^|[\s;{])(?:top|bottom)\s*:/m, 'use inset-block-start / inset-block-end'],
  [
    /border-(?:top|bottom)(?:-(?:left|right))?(?:-radius)?\b/,
    'use border-block-*, border-*-*-radius',
  ],
  [/(?:margin|padding)-(?:top|bottom)\b/, 'use margin-block-*, padding-block-*'],
  [/(?<![\w-])(?:min-|max-)?(?:width|height)\s*:/, 'use inline-size / block-size'],
  [/text-align\s*:\s*(?:left|right)/, 'use text-align: start / end'],
  [/float\s*:\s*(?:left|right)/, 'use float: inline-start / inline-end'],
  [
    /(?<![\w-])(?:margin|padding|inset|border-(?:width|style|color|radius))\s*:\s*\S+\s+\S+\s+\S+/,
    'a 3- or 4-value shorthand is physical: use the -block and -inline properties',
  ],
  [/translateX\(/, 'mirror with the direction, not a physical translate'],
  [/background-position(?:-x)?\s*:[^;]*\b(?:left|right)\b/, 'position from start / end'],
];

const tsxRules: [RegExp, string][] = [
  [/\b(?:margin|padding|border)(?:Left|Right|Top|Bottom)\b/, 'use marginInlineStart…'],
  [/\b(?:left|right|top|bottom)\s*:/, 'use insetInlineStart…'],
  [
    /\b(?:margin|padding|inset|border(?:Width|Style|Color|Radius))\s*:\s*['"`][^'"`]*?\S+\s+\S+\s+\S+/,
    'a 3- or 4-value shorthand is physical: use marginBlock, marginInline…',
  ],
  [/translateX\(/, 'mirror with the direction, not a physical translate'],
  [/textAlign\s*:\s*['"](?:left|right)['"]/, "use textAlign: 'start' / 'end'"],
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return entry.name === 'routeTree.gen.ts' ? [] : [path];
  });
}

function violations(path: string, rules: [RegExp, string][]): string[] {
  const text = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return text
    .split('\n')
    .flatMap((line, index) =>
      rules
        .filter(([pattern]) => pattern.test(line))
        .map(([, hint]) => `${relative(srcDir, path)}:${index + 1} ${line.trim()} (${hint})`),
    );
}

/** Lines each rule must catch, so a rule that stops matching fails here instead of passing silently. */
const cssSamples = [
  'margin-left: 1rem;',
  'right: 0;',
  'top: 0;',
  'border-top-left-radius: 4px;',
  'padding-bottom: 1rem;',
  'width: 10rem;',
  'text-align: left;',
  'float: right;',
  'padding: 0 var(--space-4) 0 0;',
  'transform: translateX(4px);',
  'background-position: left center;',
];
const tsxSamples = [
  'style={{ marginLeft: 8 }}',
  'style={{ left: spacing }}',
  "style={{ margin: '0 0 0 8px' }}",
  "style={{ transform: 'translateX(4px)' }}",
  "style={{ textAlign: 'right' }}",
];

describe('logical CSS rules', () => {
  it('catch every physical sample', () => {
    expect(cssSamples.filter((line) => !cssRules.some(([pattern]) => pattern.test(line)))).toEqual(
      [],
    );
    expect(tsxSamples.filter((line) => !tsxRules.some(([pattern]) => pattern.test(line)))).toEqual(
      [],
    );
  });

  it('allow the logical forms', () => {
    const logical = [
      'margin-inline: auto;',
      'padding-block: 0 var(--space-2);',
      'inset-inline-start: 0;',
      'max-inline-size: 40rem;',
      'border-radius: var(--radius);',
      'text-align: start;',
    ];
    expect(logical.filter((line) => cssRules.some(([pattern]) => pattern.test(line)))).toEqual([]);
  });
});

describe('logical CSS only', () => {
  const sources = files(srcDir);

  it('finds the styles and components', () => {
    expect(sources.some((path) => extname(path) === '.css')).toBe(true);
    expect(sources.some((path) => extname(path) === '.tsx')).toBe(true);
  });

  it('uses no physical property in a stylesheet', () => {
    const found = sources
      .filter((path) => extname(path) === '.css')
      .flatMap((path) => violations(path, cssRules));
    expect(found).toEqual([]);
  });

  it('uses no physical property in an inline style', () => {
    const found = sources
      .filter((path) => ['.ts', '.tsx'].includes(extname(path)))
      .flatMap((path) => violations(path, tsxRules));
    expect(found).toEqual([]);
  });
});
