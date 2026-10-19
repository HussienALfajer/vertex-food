import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { logoShape, markShape } from './logo.js';
import { palette } from './palette.js';

const brandFile = (file: string) =>
  readFileSync(new URL(`../../../brand/logo/svg/${file}`, import.meta.url), 'utf8');

function brandShape(file: string) {
  const source = brandFile(file);
  return {
    viewBox: /viewBox="([^"]+)"/.exec(source)?.[1],
    d: /<path[^>]*\sd="([^"]+)"/.exec(source)?.[1],
  };
}

/** The background square's fill (if any) and the mark's fill, lowercase. */
function fills(file: string): [string | undefined, string | undefined] {
  const source = brandFile(file);
  const rect = /<rect[^>]*\sfill="([^"]+)"/.exec(source)?.[1];
  const path = /<path[^>]*\sfill="([^"]+)"/.exec(source)?.[1];
  return [rect?.toLowerCase(), path?.toLowerCase()];
}

describe('logo shapes', () => {
  it('match the logo files in brand/logo/svg', () => {
    expect(logoShape).toEqual(brandShape('vertex-food-logo.svg'));
    expect(markShape).toEqual(brandShape('vertex-food-mark.svg'));
  });

  it('are the only shapes of every logo file, favicon and app icon', () => {
    const files = readdirSync(new URL('../../../brand/logo/svg/', import.meta.url));
    expect(files).toContain('driver-app-icon.svg');
    for (const file of files) {
      expect([logoShape.d, markShape.d], file).toContain(brandShape(file).d);
    }
  });

  it('carry the colorways and app icons of the identity (§7, §11)', () => {
    const green = palette.green[800];
    const sand = palette.gold[400];
    expect(fills('app-icon.svg')).toEqual([green, sand]);
    expect(fills('driver-app-icon.svg')).toEqual([sand, green]);
    expect(fills('favicon.svg')).toEqual([green, sand]);
    for (const shape of ['logo', 'mark']) {
      expect(fills(`vertex-food-${shape}.svg`)).toEqual([undefined, 'currentcolor']);
      expect(fills(`vertex-food-${shape}-green.svg`)).toEqual([undefined, green]);
      expect(fills(`vertex-food-${shape}-gold.svg`)).toEqual([undefined, sand]);
      expect(fills(`vertex-food-${shape}-white.svg`)).toEqual([undefined, palette.white]);
    }
  });
});
