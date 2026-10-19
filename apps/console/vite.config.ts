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
  server: { port: 5274, strictPort: true },
  preview: { port: 4274, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
