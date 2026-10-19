import { palette } from './palette.js';

/*
 * Semantic roles (brand/identity.md §2) that every platform shares, light and dark. The dark theme
 * is the logo's own inverse: sand on deep green. `packages/ui` declares the same roles as CSS
 * variables (its test compares them) plus web-only ones built with `color-mix()`.
 */

const { green, gold, neutral, danger } = palette;

export const lightColors = {
  background: neutral[50],
  foreground: neutral[900],
  surface: palette.white,
  surfaceForeground: neutral[900],
  muted: neutral[100],
  mutedForeground: neutral[600],
  border: neutral[200],
  /** Form controls need 3:1 against the surface (WCAG 1.4.11), stronger than structural borders. */
  input: neutral[500],
  primary: green[800],
  primaryHover: green[700],
  primaryForeground: palette.white,
  secondary: neutral[100],
  secondaryHover: neutral[200],
  secondaryForeground: neutral[900],
  accent: gold[400],
  accentForeground: green[950],
  accentText: gold[700],
  destructive: danger[600],
  destructiveHover: danger[700],
  destructiveForeground: palette.white,
  destructiveText: danger[700],
  ring: gold[500],
} as const;

export type SemanticColors = { [Role in keyof typeof lightColors]: string };

export const darkColors: SemanticColors = {
  background: green[950],
  foreground: neutral[100],
  surface: green[900],
  surfaceForeground: neutral[100],
  muted: green[800],
  // neutral-300: muted text also sits on the muted surface (table heads, toggles).
  mutedForeground: neutral[300],
  border: green[700],
  input: green[500],
  primary: gold[400],
  primaryHover: gold[300],
  primaryForeground: green[950],
  secondary: green[800],
  secondaryHover: green[700],
  secondaryForeground: neutral[100],
  accent: gold[400],
  accentForeground: green[950],
  accentText: gold[300],
  destructive: danger[600],
  destructiveHover: danger[700],
  destructiveForeground: palette.white,
  // The web mixes danger-500 and danger-100 here; native platforms use danger-100.
  destructiveText: danger[100],
  ring: gold[400],
};
