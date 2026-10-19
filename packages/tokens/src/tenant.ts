import { contrast } from './contrast.js';
import { palette } from './palette.js';
import { darkColors, lightColors } from './semantic.js';

/*
 * The restaurant's identity inside the Vertex identity (ADR 0010 layer 1, ADR 0018, brand/identity.md
 * §10): one accent color, its logo and its cover. The theme exposes them as tokens; components read
 * them only on the surfaces ADR 0010 lists, and the rest of each surface keeps the Vertex identity.
 * Branding records are validated by `packages/contracts` (contrast checks, S08) before they get here.
 */

export type ThemeScheme = 'light' | 'dark';

/** A restaurant's identity as the theme reads it. Every slot is optional: unset, Vertex applies. */
export interface TenantIdentity {
  /** The restaurant's one primary color, `#rrggbb`. */
  accent?: string;
  /** URL of the restaurant's logo image. */
  logoUrl?: string;
  /** URL of the restaurant's cover image. */
  coverUrl?: string;
}

/** The two color tokens a restaurant fills: its accent and the text drawn on it. */
export interface TenantColors {
  tenantAccent: string;
  tenantAccentForeground: string;
}

const hexColor = /^#[0-9a-f]{6}$/i;

/** The text color that reads better on `background`: white or green-950, as the primary roles use. */
export function readableOn(background: string): string {
  const light = palette.white;
  const dark = palette.green[950];
  return contrast(light, background) >= contrast(dark, background) ? light : dark;
}

/** The restaurant's accent as a lowercase `#rrggbb`, or `undefined` when unset or not a color. */
export function tenantAccent(identity: TenantIdentity | undefined): string | undefined {
  const accent = identity?.accent;
  return accent !== undefined && hexColor.test(accent) ? accent.toLowerCase() : undefined;
}

/**
 * The tenant tokens of one scheme. Without an accent, or with anything that is not a `#rrggbb`
 * color (a value is never passed to CSS unchecked), they are the theme's primary roles.
 */
export function tenantColors(
  identity: TenantIdentity | undefined,
  scheme: ThemeScheme,
): TenantColors {
  const accent = tenantAccent(identity);
  if (accent === undefined) {
    const theme = scheme === 'dark' ? darkColors : lightColors;
    return { tenantAccent: theme.primary, tenantAccentForeground: theme.primaryForeground };
  }
  return { tenantAccent: accent, tenantAccentForeground: readableOn(accent) };
}
