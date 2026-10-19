import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from '@tailwindcss/node';
import {
  darkColors,
  fontFamily,
  fontSize,
  lightColors,
  palette,
  radius,
} from '@vertex-food/tokens';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('.', import.meta.url));
const theme = readFileSync(new URL('./styles/theme.css', import.meta.url), 'utf8');

/** `--color-green-50: #e8fcf8;` → { 'green-50': '#e8fcf8' } */
const themeColors = Object.fromEntries(
  [...theme.matchAll(/--color-([a-z]+-\d+):\s*(#[0-9a-f]{6});/g)].map(([, name, hex]) => [
    name,
    hex,
  ]),
);

const paletteColors = Object.fromEntries(
  Object.entries(palette).flatMap(([scale, steps]) =>
    typeof steps === 'string'
      ? []
      : Object.entries(steps).map(([step, hex]) => [`${scale}-${step}`, hex]),
  ),
);

/** The roles of one block (`:root { … }`), each resolved to its palette color: `--primary` → hex. */
function roles(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/^\s*--([a-z-]+):\s*var\(--color-([a-z]+(?:-\d+)?)\);/gm)].map(
      ([, role, color = '']) => [
        role,
        color === 'white' ? palette.white : (themeColors[color] ?? ''),
      ],
    ),
  );
}

const lightBlock = theme.slice(theme.indexOf(':root {'), theme.indexOf('.dark {'));
const darkBlock = theme.slice(theme.indexOf('.dark {'));

/** `primaryForeground` → `primary-foreground` */
const cssName = (role: string) => role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('design tokens', () => {
  it('declare the palette of packages/tokens', () => {
    expect(themeColors).toEqual(paletteColors);
    expect(theme).toContain(`--color-white: ${palette.white};`);
  });

  it('give the semantic roles the colors of packages/tokens', () => {
    for (const [colors, block] of [
      [lightColors, roles(lightBlock)],
      [darkColors, roles(darkBlock)],
    ] as const) {
      for (const [role, hex] of Object.entries(colors)) {
        // The web mixes a few dark roles with color-mix(); those are not palette references.
        if (
          block[cssName(role)] === undefined &&
          darkBlock.includes(`--${cssName(role)}: color-mix(`)
        )
          continue;
        expect(block[cssName(role)], role).toBe(hex);
      }
    }
  });
});

describe('scales', () => {
  it('follow the type scale and radii of packages/tokens', () => {
    for (const [token, { size, lineHeight }] of Object.entries(fontSize)) {
      expect(theme, token).toContain(`--text-${token}: ${size / 16}rem;`);
      expect(theme, token).toContain(`--text-${token}--line-height: ${lineHeight / 16}rem;`);
    }
    for (const [token, px] of Object.entries(radius)) {
      expect(theme, token).toContain(`--radius-${token}: ${px}px;`);
    }
  });

  it('use the font stack of packages/tokens', () => {
    const generic = new Set(['system-ui', 'sans-serif']);
    const stack = fontFamily.map((name) => (generic.has(name) ? name : `"${name}"`)).join(', ');
    expect(theme).toContain(`--font-sans: ${stack};`);
  });
});

describe('generated utilities', async () => {
  const compiler = await compile('@import "tailwindcss";\n@import "./styles/index.css";', {
    base: srcDir,
    onDependency: () => {},
  });
  const build = (candidate: string) => compiler.build([candidate]);

  it('exist for brand tokens', () => {
    for (const candidate of ['bg-primary', 'bg-green-800', 'text-accent-text', 'shadow-float']) {
      expect(build(candidate), candidate).toContain(`.${candidate}`);
    }
  });

  it('follow the Vertex type scale', () => {
    expect(build('text-base')).toMatch(/--text-base:\s*0\.9375rem/);
    expect(build('text-md')).toContain('.text-md');
  });

  it('do not exist for colors, shadows and effects outside the identity', () => {
    for (const candidate of [
      'bg-blue-500',
      'text-purple-600',
      'bg-black',
      'shadow-lg',
      'drop-shadow-xl',
      'backdrop-blur-md',
      'font-mono',
      'font-serif',
      'rounded-2xl',
      'rounded-4xl',
    ]) {
      expect(build(candidate), candidate).not.toContain(`.${candidate}`);
    }
  });
});

describe('dark theme', async () => {
  const compiler = await compile(
    ['@import "tailwindcss";', '@import "./styles/index.css";'].join('\n'),
    { base: srcDir, onDependency: () => {} },
  );
  const css = compiler.build(['dark:bg-surface']);

  it('applies with the dark class on <html>, whatever the system says', () => {
    const start = css.indexOf('.dark {');
    expect(css.slice(start, css.indexOf('}', start))).toContain(
      '--background: var(--color-green-950);',
    );
    expect(css).not.toContain('prefers-color-scheme');
  });

  it('gives the dark: variant the same class', () => {
    expect(css).toContain(String.raw`.dark\:bg-surface:where(.dark, .dark *)`);
  });
});
