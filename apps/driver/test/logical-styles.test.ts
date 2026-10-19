import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Arabic-first RTL (ADR 0018, ADR 0020): styles use logical properties only, so the screens mirror
// without per-direction rules. The rules copy apps/console's logical-CSS test for React Native
// style objects and move to the packages/ui-native convention test with the design system.

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

const rules: [RegExp, string][] = [
  [
    /\b(?:margin|padding|border)(?:Left|Right|Top|Bottom)\b/,
    'use marginInlineStart, paddingBlock…',
  ],
  [/\bborder(?:Left|Right|Top|Bottom)\w*/, 'use borderStart*, borderEnd*, borderBlock*…'],
  [/\b(?:left|right|top|bottom)\s*:/, 'use insetInlineStart, insetBlockStart…'],
  [/\b(?:margin|padding)(?:Horizontal|Vertical)\b/, 'use marginInline, paddingBlock…'],
  [
    /\b(?:margin|padding|inset|border(?:Width|Style|Color|Radius))\s*:\s*['"`][^'"`]*?\S+\s+\S+\s+\S+/,
    'a 3- or 4-value shorthand is physical: use marginBlock, marginInline…',
  ],
  [/translateX\b/, 'mirror with the direction, not a physical translate'],
  [/textAlign\s*:\s*['"](?:left|right)['"]/, "use textAlign: 'auto' (start)"],
  [
    /flexDirection\s*:\s*['"]row-reverse['"]/,
    "use flexDirection: 'row', which follows the direction",
  ],
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function violations(path: string): string[] {
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
const samples = [
  'style={{ marginLeft: 8 }}',
  'borderTopLeftRadius: 4,',
  'borderBottomWidth: 1,',
  'style={{ left: spacing }}',
  'top: 0,',
  'paddingHorizontal: 16,',
  "style={{ margin: '0 0 0 8px' }}",
  'transform: [{ translateX: 4 }],',
  "style={{ textAlign: 'right' }}",
  "flexDirection: 'row-reverse',",
];

describe('logical style rules', () => {
  it('catch every physical sample', () => {
    expect(samples.filter((line) => !rules.some(([pattern]) => pattern.test(line)))).toEqual([]);
  });

  it('allow the logical forms', () => {
    const logical = [
      'marginInlineStart: 8,',
      'paddingBlock: space[3],',
      'insetInlineEnd: 0,',
      'marginBlockEnd: space[2],',
      'borderRadius: radius,',
      "textAlign: 'auto',",
      "flexDirection: 'row',",
    ];
    expect(logical.filter((line) => rules.some(([pattern]) => pattern.test(line)))).toEqual([]);
  });
});

describe('logical styles only', () => {
  const sources = files(srcDir).filter((path) => ['.ts', '.tsx'].includes(extname(path)));

  it('finds the components', () => {
    expect(sources.some((path) => extname(path) === '.tsx')).toBe(true);
  });

  it('uses no physical style property', () => {
    expect(sources.flatMap((path) => violations(path))).toEqual([]);
  });
});
