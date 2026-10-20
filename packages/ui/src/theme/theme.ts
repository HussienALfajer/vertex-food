/**
 * Light or dark, as in Vertex Hub (ADR 0018): the system's setting until the user presses the
 * theme button, then the choice, kept on the device. `themeInitScript` puts the `dark` class on
 * <html> before the first paint; `styles/theme.css` keys the dark tokens on it.
 */
export type Theme = 'light' | 'dark';

/** The `localStorage` key of the choice (Vertex Hub's; the customer and driver apps use it too). */
export const themeStorageKey = 'vertex-theme';

/** The media query of the system's dark setting. */
export const systemDarkQuery = '(prefers-color-scheme: dark)';

/**
 * Runs synchronously from `<head>`, before the body is painted: a file the app serves from
 * `'self'` (`theme-init.js`), since the restaurant app's CSP forbids inline scripts. Only `light`
 * or `dark` counts as a saved choice; without one, or when storage is unavailable (blocked,
 * private mode), the system setting applies. The two reads fail separately.
 */
export const themeInitScript = `var saved = null;
try {
  saved = localStorage.getItem(${JSON.stringify(themeStorageKey)});
} catch (error) {}
var dark = false;
if (saved === 'light' || saved === 'dark') {
  dark = saved === 'dark';
} else {
  try {
    dark = matchMedia(${JSON.stringify(systemDarkQuery)}).matches;
  } catch (error) {}
}
document.documentElement.classList.toggle('dark', dark);
`;

/** The path apps serve `themeInitScript` at. */
export const themeInitPath = '/theme-init.js';
