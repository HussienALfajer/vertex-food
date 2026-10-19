import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Guards for the UI conventions (AGENTS.md, ADR 0018, ADR 0020) and the patterns to avoid in
 * brand/identity.md §8, applied to every source file of the design system and the web apps:
 * Arabic-first RTL with logical directions only, colors from the theme only.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sourceDirs = ['packages/ui/src', 'apps/restaurant/src', 'apps/console/src', 'apps/web/src'];

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(tsx?|css)$/.test(entry.name))
    .filter((entry) => !/\.(test|gen)\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

const files = sourceDirs.flatMap(sourceFiles);
const path = (file: string) => relative(root, file).split(sep).join('/');

/** Lines matching a pattern, as `path:line: text`, block comments removed. */
function violations(pattern: RegExp, only: (file: string) => boolean = () => true): string[] {
  return files.filter(only).flatMap((file) =>
    readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
      .split('\n')
      .flatMap((line, i) => (pattern.test(line) ? [`${path(file)}:${i + 1}: ${line.trim()}`] : [])),
  );
}

const css = (file: string) => file.endsWith('.css');
const script = (file: string) => !css(file);

/** A utility class: preceded by a quote, space, backtick or variant colon; followed by a boundary. */
const utility = (body: string) =>
  new RegExp(String.raw`(?<=["'${'`'}\s:])-?(?:${body})(?=[\s"'${'`'}]|$)`);

const value = String.raw`[\w./[\]-]+`;

const physicalUtility = utility(
  [
    `(?:m|p|scroll-m|scroll-p)[lr]-${value}`,
    `(?:left|right)-${value}`,
    'text-(?:left|right)',
    `(?:border|rounded)-[lr](?:-${value})?`,
    `rounded-[tb][lr](?:-${value})?`,
    'float-(?:left|right)',
  ].join('|'),
);

/** Physical properties in a stylesheet; each rule has a sample below. */
const physicalCss: [RegExp, string][] = [
  [/(?:margin|padding|border|inset)-(?:left|right)\b/, 'margin-left: 1rem;'],
  [/(?:^|[\s;{])(?:left|right)\s*:/m, 'right: 0;'],
  [/(?:^|[\s;{])(?:top|bottom)\s*:/m, 'top: 0;'],
  [/border-(?:top|bottom)(?:-(?:left|right))?(?:-radius)?\b/, 'border-top-left-radius: 4px;'],
  [/(?:margin|padding)-(?:top|bottom)\b/, 'padding-bottom: 1rem;'],
  [/(?<![\w-])(?:min-|max-)?(?:width|height)\s*:/, 'width: 10rem;'],
  [/text-align\s*:\s*(?:left|right)/, 'text-align: left;'],
  [/float\s*:\s*(?:left|right)/, 'float: right;'],
  [
    /(?<![\w-])(?:margin|padding|inset|border-(?:width|style|color|radius))\s*:\s*\S+\s+\S+\s+\S+/,
    'padding: 0 1rem 0 0;',
  ],
  [/translateX\(/, 'transform: translateX(4px);'],
  [/background-position(?:-x)?\s*:[^;]*\b(?:left|right)\b/, 'background-position: left center;'],
];

/** Physical properties in an inline style object; each rule has a sample below. */
const physicalStyle: [RegExp, string][] = [
  [/\b(?:margin|padding|border)(?:Left|Right|Top|Bottom)\b/, 'style={{ marginLeft: 8 }}'],
  [/\b(?:left|right|top|bottom)\s*:\s*[\w'"`(-]/, 'style={{ left: -4 }}'],
  [
    /\b(?:margin|padding|inset|border(?:Width|Style|Color|Radius))\s*:\s*['"`][^'"`]*?\S+\s+\S+\s+\S+/,
    "style={{ margin: '0 0 0 8px' }}",
  ],
  [/textAlign\s*:\s*['"](?:left|right)['"]/, "style={{ textAlign: 'right' }}"],
];

/**
 * `translate-x-*` moves the same way in both directions: it is allowed only under an `ltr:` or
 * `rtl:` variant, paired with its mirror (`ltr:-translate-x-1/2 rtl:translate-x-1/2`).
 */
function unpairedTranslate(line: string): boolean {
  return line
    .split(/[\s"'`]+/)
    .some((token) => /(?:^|:)-?translate-x-/.test(token) && !/(?:^|:)(?:ltr|rtl):/.test(token));
}

/** A color written as a value instead of a token. */
const colorValue = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|color-mix\(/;

const anyOf = (rules: [RegExp, string][]) =>
  new RegExp(rules.map(([pattern]) => `(?:${pattern.source})`).join('|'), 'm');

describe('UI conventions', () => {
  it('finds the sources it checks', () => {
    for (const dir of sourceDirs) {
      expect(
        files.some((file) => path(file).startsWith(`${dir}/`)),
        dir,
      ).toBe(true);
    }
    expect(files.some(css)).toBe(true);
  });

  it('has rules that catch every physical sample', () => {
    for (const [pattern, sample] of [...physicalCss, ...physicalStyle]) {
      expect(pattern.test(sample), sample).toBe(true);
    }
    expect(physicalUtility.test('className="ml-2"')).toBe(true);
    expect(physicalUtility.test('  @apply ml-2 text-left;')).toBe(true);
    expect(unpairedTranslate('className="data-checked:translate-x-4"')).toBe(true);
    expect(unpairedTranslate('className="-translate-x-1/2"')).toBe(true);
    expect(unpairedTranslate("'ltr:-translate-x-1/2 rtl:data-open:translate-x-1/2'")).toBe(false);
    expect(colorValue.test('color: hsl(10 20% 30%);')).toBe(true);
    expect(colorValue.test('background: color-mix(in oklch, red, blue);')).toBe(true);
    const logical = ['margin-inline: auto;', 'inset-inline-start: 0;', 'max-inline-size: 40rem;'];
    expect(logical.filter((line) => anyOf(physicalCss).test(line))).toEqual([]);
  });

  it('uses logical directions only (RTL first)', () => {
    expect(violations(physicalUtility, script)).toEqual([]);
    expect(violations(physicalUtility, css).filter((line) => line.includes('@apply'))).toEqual([]);
    expect(violations({ test: unpairedTranslate } as RegExp, script)).toEqual([]);
    expect(violations(anyOf(physicalCss), css)).toEqual([]);
    // Scrolling by measured boxes (`scrollBy({ left })`) is geometry, not a style: it holds in RTL.
    const styles = violations(anyOf(physicalStyle), script).filter(
      (line) => !/\.scroll(?:By|To)\(/.test(line),
    );
    expect(styles).toEqual([]);
    expect(violations(/translateX\(/)).toEqual([]);
  });

  it('avoids the patterns listed in brand/identity.md §8', () => {
    const banned = utility(
      [
        `bg-(?:gradient|linear|radial|conic)-${value}`,
        `(?:from|via)-${value}`,
        'backdrop-blur(?:-[\\w-]+)?',
        'italic',
        `tracking-${value}`,
        'font-mono',
        'uppercase',
      ].join('|'),
    );
    expect(violations(banned, script)).toEqual([]);
  });

  it('keeps colors in tokens: no color values outside the theme', () => {
    const offenders = violations(colorValue).filter(
      (line) => !line.startsWith('packages/ui/src/styles/theme.css:'),
    );
    expect(offenders).toEqual([]);
  });
});
