import tailwindcss from '@tailwindcss/vite';
import { vertexFoodWeb } from '@vertex-food/ui/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { contentSecurityPolicy } from './electron/app-protocol.ts';

// The hub client pages (spec S04 screens 6–9, `hub-clients/`): a second build of this app, served
// by the hub PC's LAN server (`electron/hub-lan.ts`) from `dist/hub-clients/` beside the renderer.
// The preview sends the policy the hub sends; the hub adds both hub-capable PCs to `connect-src`.
export default defineConfig({
  root: 'hub-clients',
  plugins: [react(), tailwindcss(), vertexFoodWeb()],
  server: { port: 5278, strictPort: true },
  preview: {
    port: 4278,
    strictPort: true,
    headers: { 'Content-Security-Policy': contentSecurityPolicy([]) },
  },
  build: { outDir: '../dist/hub-clients', emptyOutDir: true },
});
