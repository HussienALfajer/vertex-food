/*
 * WCAG 2.2 contrast between two `#rrggbb` colors: the identity's measured ratios (brand/identity.md
 * §2) and the restaurant color's checks (ADR 0010) use it.
 */

/** Relative luminance of a `#rrggbb` color. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of two colors, from 1 to 21, whichever is lighter. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
