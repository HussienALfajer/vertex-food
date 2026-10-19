import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast } from './contrast.js';
import { palette } from './palette.js';
import { fontSize, radius } from './scale.js';
import { darkColors, lightColors } from './semantic.js';

const identity = readFileSync(new URL('../../../brand/identity.md', import.meta.url), 'utf8');

/** `{ green: { 50: '#e8fcf8' } }` → { 'green-50': '#e8fcf8' } */
const paletteColors: Record<string, string> = Object.fromEntries(
  Object.entries(palette).flatMap(([scale, steps]) =>
    typeof steps === 'string'
      ? []
      : Object.entries(steps).map(([step, hex]) => [`${scale}-${step}`, hex]),
  ),
);

/** Rows like "| 50 | `#E8FCF8` | `#FCF7E7` | ..." under a header naming the scales. */
function identityScale(heading: string, scales: string[]): Record<string, string> {
  const section = identity.slice(identity.indexOf(heading));
  const table = section.slice(0, section.indexOf('\n\n', section.indexOf('|')));
  const colors: Record<string, string> = {};
  for (const line of table.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    const step = cells[1];
    if (!step || !/^\d+$/.test(step)) continue;
    scales.forEach((scale, i) => {
      const hex = /#[0-9A-Fa-f]{6}/.exec(cells[i + 2] ?? '')?.[0];
      if (hex) colors[`${scale}-${step}`] = hex.toLowerCase();
    });
  }
  return colors;
}

describe('palette', () => {
  it('matches every tonal and status color in brand/identity.md', () => {
    const expected = {
      ...identityScale('### Tonal scales', ['green', 'gold', 'neutral']),
      ...identityScale('### Status colors', ['success', 'warning', 'danger', 'info']),
    };
    expect(Object.keys(expected)).toHaveLength(33 + 20);
    expect(paletteColors).toEqual(expected);
  });

  it('keeps the brand colors at green-800 and gold-400', () => {
    expect(palette.green[800]).toBe('#004139');
    expect(palette.gold[400]).toBe('#b9a87a');
  });

  it('meets the contrast ratios measured in the identity', () => {
    const c = (a: string, b: string) => contrast(paletteColors[a] ?? a, paletteColors[b] ?? b);
    expect(c('#ffffff', 'green-800')).toBeGreaterThanOrEqual(7); // primary button, light
    expect(c('green-950', 'gold-400')).toBeGreaterThanOrEqual(7); // primary button, dark
    expect(c('neutral-900', 'neutral-50')).toBeGreaterThanOrEqual(7); // body text, light
    expect(c('neutral-600', '#ffffff')).toBeGreaterThanOrEqual(4.5); // muted text, light
    expect(c('neutral-300', 'green-900')).toBeGreaterThanOrEqual(4.5); // muted text, dark
    // Muted text on the muted surface: table heads and toggle groups.
    expect(c('neutral-300', 'green-800')).toBeGreaterThanOrEqual(4.5); // dark
    expect(c('neutral-600', 'neutral-100')).toBeGreaterThanOrEqual(4.5); // light
    expect(c('neutral-100', 'green-800')).toBeGreaterThanOrEqual(7); // sidebar text
    expect(c('gold-700', '#ffffff')).toBeGreaterThanOrEqual(4.5); // accent as text, light
    expect(c('neutral-500', '#ffffff')).toBeGreaterThanOrEqual(3); // input border, light
    expect(c('gold-500', 'neutral-50')).toBeGreaterThanOrEqual(3); // focus ring, light
    expect(c('gold-400', 'green-800')).toBeGreaterThanOrEqual(3); // sidebar focus and marker
    // Sand on white fails: it is never used for text or icons on light surfaces.
    expect(c('gold-400', '#ffffff')).toBeLessThan(3);
  });
});

describe('semantic colors', () => {
  it('use only palette colors', () => {
    const known = new Set([...Object.values(paletteColors), palette.white]);
    for (const [role, hex] of [...Object.entries(lightColors), ...Object.entries(darkColors)]) {
      expect(known.has(hex), role).toBe(true);
    }
  });

  it('keep text readable on its surfaces in both themes', () => {
    for (const colors of [lightColors, darkColors]) {
      expect(contrast(colors.foreground, colors.background)).toBeGreaterThanOrEqual(7);
      expect(contrast(colors.surfaceForeground, colors.surface)).toBeGreaterThanOrEqual(7);
      expect(contrast(colors.mutedForeground, colors.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.primaryForeground, colors.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.destructiveForeground, colors.destructive)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(colors.accentText, colors.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.ring, colors.background)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('scales', () => {
  it('follow the identity type scale and radii', () => {
    const scale = identity.slice(identity.indexOf('| Token | Size | Line height |'));
    for (const [token, { size, lineHeight }] of Object.entries(fontSize)) {
      expect(scale, token).toContain(`| ${token} | ${size} | ${lineHeight} |`);
    }
    expect(identity).toContain(
      `sm ${radius.sm} (badges, chips), md ${radius.md} (buttons, inputs), lg ${radius.lg} (cards), xl ${radius.xl} (dialogs, sheets)`,
    );
  });
});
