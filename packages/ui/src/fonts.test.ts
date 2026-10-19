import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { firstScreenFont, vertexFoodWeb } from './vite';

const stylesDir = new URL('./styles/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, stylesDir), 'utf8');

/** Each `@font-face` block, its `font-display` left out, in order. */
function faces(css: string): string[] {
  return [...css.matchAll(/@font-face \{([^}]*)\}/g)].map(([, body = '']) =>
    body.replace(/\s*font-display: \w+;/, '').trim(),
  );
}

describe('typefaces', () => {
  const web = read('fonts.css');
  const desktop = read('fonts-desktop.css');

  it('declare the same faces for the web and the desktop apps', () => {
    expect(faces(web)).toHaveLength(9);
    expect(faces(desktop)).toEqual(faces(web));
  });

  it('swap on the web and wait for the preloaded font on desktop', () => {
    expect(web.match(/font-display: (\w+);/g)).toEqual(Array(9).fill('font-display: swap;'));
    expect(desktop.match(/font-display: (\w+);/g)).toEqual(Array(9).fill('font-display: block;'));
  });

  it('point at files that exist, each with its unicode range', () => {
    for (const face of faces(web)) {
      const [, url = ''] = face.match(/url\("([^"]+)"\)/) ?? [];
      expect(existsSync(fileURLToPath(new URL(url, stylesDir))), url).toBe(true);
      expect(face).toMatch(/unicode-range:\s*U\+/);
    }
  });
});

describe('vertexFoodWeb', () => {
  it('preloads the first screen fonts: Arabic and basic Latin, 400, 500 and 700', () => {
    const files = [
      'assets/noto-kufi-arabic-arabic-400-normal-Ab1_c.woff2',
      'assets/noto-kufi-arabic-arabic-700-normal-x.woff2',
      'assets/montserrat-latin-500-normal-y.woff2',
    ];
    for (const file of files) expect(file).toMatch(firstScreenFont);
    for (const file of [
      'assets/montserrat-latin-ext-400-normal-z.woff2',
      'assets/montserrat-latin-400-normal-z.woff',
      'assets/noto-kufi-arabic-arabic-400-normal-z.woff2.map',
    ]) {
      expect(file).not.toMatch(firstScreenFont);
    }
  });

  it('adds theme-init.js to <head>, then the preloads', () => {
    const plugin = vertexFoodWeb();
    const transform = plugin.transformIndexHtml as {
      handler: (html: string, context: unknown) => { tag: string; attrs: object }[];
    };
    const bundle = {
      font: { type: 'asset', fileName: 'assets/montserrat-latin-400-normal-a.woff2' },
      other: { type: 'asset', fileName: 'assets/montserrat-latin-ext-400-normal-a.woff2' },
      code: { type: 'chunk', fileName: 'assets/index-a.js' },
    };
    const tags = transform.handler('', { bundle });
    expect(tags.map(({ tag, attrs }) => [tag, attrs])).toEqual([
      ['script', { src: '/theme-init.js' }],
      [
        'link',
        {
          rel: 'preload',
          as: 'font',
          type: 'font/woff2',
          href: '/assets/montserrat-latin-400-normal-a.woff2',
          crossorigin: '',
        },
      ],
    ]);
  });
});
