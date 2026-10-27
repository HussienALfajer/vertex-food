import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { vertexFoodWeb } from '@vertex-food/ui/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // The router plugin must run before the React plugin. `vertexFoodWeb` serves `theme-init.js`
  // (the theme before the first paint) and preloads the first screen's fonts.
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    vertexFoodWeb(),
  ],
  // The console calls the API on its own origin: the session cookie is `SameSite=Strict` under
  // `/api/console/` and every write's `Origin` must be the console's (spec S02 rule 41). In
  // development Vite forwards `/api` to the local API (`API_PORT`, 3100 by default); the built app
  // sits behind the host's proxy.
  server: {
    port: 5274,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 3100}` },
  },
  preview: { port: 4274, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
