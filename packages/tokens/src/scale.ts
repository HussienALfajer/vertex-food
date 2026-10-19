/* Type, space, shape and motion (brand/identity.md §3, §4, §6). Sizes in px. */

/** The 4 px grid. */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

/** No pill radius for controls: full rounding only for avatars and status dots. */
export const radius = { sm: 4, md: 6, lg: 8, xl: 12 } as const;

/** Arabic-friendly line heights. */
export const fontSize = {
  xs: { size: 12, lineHeight: 18 },
  sm: { size: 13, lineHeight: 20 },
  base: { size: 15, lineHeight: 24 },
  md: { size: 16, lineHeight: 26 },
  lg: { size: 18, lineHeight: 28 },
  xl: { size: 20, lineHeight: 30 },
  '2xl': { size: 24, lineHeight: 34 },
  '3xl': { size: 30, lineHeight: 40 },
  '4xl': { size: 36, lineHeight: 46 },
} as const;

/** 400 body, 500 labels and table headers, 700 headings. */
export const fontWeight = { regular: '400', medium: '500', bold: '700' } as const;

/** Madani Arabic covers Arabic only, so Latin letters and digits fall through to Montserrat. */
export const fontFamily = [
  'Madani Arabic',
  'Montserrat',
  'Noto Kufi Arabic',
  'system-ui',
  'sans-serif',
] as const;

/** Durations in ms, all ease-out. */
export const motion = { press: 150, popover: 200, dialog: 250 } as const;
