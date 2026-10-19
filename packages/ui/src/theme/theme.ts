/**
 * Light or dark, as in Vertex Hub (ADR 0018): the system's setting until the user presses the
 * theme button, then the choice, kept on the device. `themeInitScript` puts the `dark` class on
 * <html> before the first paint; `styles/theme.css` keys the dark tokens on it.
 */
export type Theme = 'light' | 'dark';

/** The `localStorage` key of the choice (Vertex Hub's; the customer and driver apps use it too). */
export const themeStorageKey = 'vertex-theme';

/**
 * Runs synchronously from `<head>`, before the body is painted: a file the app serves from
 * `'self'` (`theme-init.js`), since the restaurant app's CSP forbids inline scripts. Storage may be
 * unavailable (blocked, private mode): the system setting applies then.
 */
export const themeInitScript = `try {
  var saved = localStorage.getItem(${JSON.stringify(themeStorageKey)});
  var dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
} catch (error) {}
`;

/** The path apps serve `themeInitScript` at. */
export const themeInitPath = '/theme-init.js';
