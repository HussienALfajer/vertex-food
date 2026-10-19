import { themeInitScript } from '@vertex-food/ui/theme';

// `theme-init.js` from the app's own origin, built once as a static file (the same script the
// Vite apps serve, packages/ui).
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(themeInitScript, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
  });
}
