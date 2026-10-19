/**
 * Light or dark, as on the web (`packages/ui`, Vertex Hub's toggle): the system's setting until
 * the user presses the theme button, then the choice, kept on the device.
 */
export type ThemeName = 'light' | 'dark';

/** The storage key of the choice: the web apps use the same one in `localStorage`. */
export const themeStorageKey = 'vertex-theme';

/** A stored value read back: a choice, or none. */
export function parseSavedTheme(value: unknown): ThemeName | null {
  return value === 'light' || value === 'dark' ? value : null;
}

/** The scheme drawn: the saved choice, or the system's setting (light when it says nothing). */
export function resolveScheme(
  saved: ThemeName | null,
  system: string | null | undefined,
): ThemeName {
  return saved ?? (system === 'dark' ? 'dark' : 'light');
}
