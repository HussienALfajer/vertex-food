import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { vertexFoodWeb } from '@vertex-food/ui/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { connectOrigins, contentSecurityPolicy } from './electron/app-protocol.ts';

export default defineConfig(({ mode }) => ({
  // The router plugin must run before the React plugin. `vertexFoodWeb` serves `theme-init.js`
  // (the theme before the first paint) and preloads the first screen's fonts.
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    vertexFoodWeb(),
  ],
  server: { port: 5273, strictPort: true },
  // The E2E runs the built renderer under the CSP Electron sends with every response.
  preview: {
    port: 4273,
    strictPort: true,
    headers: {
      'Content-Security-Policy': contentSecurityPolicy(
        connectOrigins({ ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }),
      ),
    },
  },
  build: { outDir: 'dist/renderer', emptyOutDir: true },
}));
