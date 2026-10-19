import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { logoShape, markShape } from './logo.js';

function brandShape(file: string) {
  const source = readFileSync(new URL(`../../../brand/logo/svg/${file}`, import.meta.url), 'utf8');
  return {
    viewBox: /viewBox="([^"]+)"/.exec(source)?.[1],
    d: /<path[^>]*\sd="([^"]+)"/.exec(source)?.[1],
  };
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
});
