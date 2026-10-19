import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { vertexFoodWeb } from '@vertex-food/ui/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import {
  CONNECT_ORIGINS_FILE,
  connectOrigins,
  contentSecurityPolicy,
  readConnectOrigins,
} from './electron/app-protocol.ts';

const outDir = 'dist/renderer';

/**
 * Writes the API origin the renderer is built with (`VITE_API_URL`, from the environment or a
 * `.env` file, as Vite reads it) next to the renderer, for the main process's CSP.
 */
function connectOriginsFile(mode: string): Plugin {
  return {
    name: 'vertex-food-connect-origins',
    apply: 'build',
    generateBundle() {
      const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
      this.emitFile({
        type: 'asset',
        fileName: CONNECT_ORIGINS_FILE,
        source: JSON.stringify(connectOrigins(env)),
      });
    },
  };
}

/** The origins of the built renderer, for the preview's CSP (none before the first build). */
function builtConnectOrigins(): string[] {
  try {
    return readConnectOrigins(readFileSync(`${outDir}/${CONNECT_ORIGINS_FILE}`, 'utf8'));
  } catch {
    return [];
  }
}

export default defineConfig(({ mode }) => ({
  // The router plugin must run before the React plugin. `vertexFoodWeb` serves `theme-init.js`
  // (the theme before the first paint) and preloads the first screen's fonts.
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    vertexFoodWeb(),
    connectOriginsFile(mode),
  ],
  server: { port: 5273, strictPort: true },
  // The E2E runs the built renderer under the CSP Electron sends with every response, from the
  // same file the main process reads.
  preview: {
    port: 4273,
    strictPort: true,
    headers: { 'Content-Security-Policy': contentSecurityPolicy(builtConnectOrigins()) },
  },
  build: { outDir, emptyOutDir: true },
}));
