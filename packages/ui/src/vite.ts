import type { HtmlTagDescriptor, Plugin } from 'vite';
import { themeInitPath, themeInitScript } from './theme/theme.ts';

/**
 * The font files the first screen draws with (Noto Kufi Arabic and Montserrat's Latin subset, 400,
 * 500 and 700): preloaded, so text is drawn once, in its own font (`fonts-desktop.css`).
 */
export const firstScreenFont =
  /(?:^|\/)(?:noto-kufi-arabic-arabic|montserrat-latin)-(?:400|500|700)-normal-[\w-]+\.woff2$/;

/**
 * What every Vite web app of the design system needs in its `index.html` (restaurant, console):
 * `theme-init.js` in `<head>`, served from the app's own origin (the restaurant app's CSP allows
 * scripts from `'self'` only) and run before the body is painted, and in the build the first
 * screen's fonts preloaded. The tags go after the document's own (`<meta charset>` stays first).
 */
export function vertexFoodWeb(): Plugin {
  let base = '/';
  const scriptFile = themeInitPath.slice(1);
  return {
    name: 'vertex-food-web',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use(themeInitPath, (_request, response) => {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(themeInitScript);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: scriptFile, source: themeInitScript });
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        const tags: HtmlTagDescriptor[] = [
          { tag: 'script', attrs: { src: `${base}${scriptFile}` }, injectTo: 'head' },
        ];
        for (const file of Object.values(context.bundle ?? {})) {
          if (file.type !== 'asset' || !firstScreenFont.test(file.fileName)) continue;
          tags.push({
            tag: 'link',
            attrs: {
              rel: 'preload',
              as: 'font',
              type: 'font/woff2',
              href: `${base}${file.fileName}`,
              // Fonts are fetched in CORS mode: the preload must match to be reused.
              crossorigin: '',
            },
            injectTo: 'head',
          });
        }
        return tags;
      },
    },
  };
}
