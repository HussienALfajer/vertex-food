// Runs a restaurant PC (pc/pc.mjs) in Electron's main process, as the Windows app would: no window, the local
// database in worker threads, the LAN server in the main process. Configuration comes from PC_CONFIG.
import { app } from 'electron';

app.on('window-all-closed', () => {});
app.whenReady().then(() => import('../pc/pc.mjs')).catch((e) => {
  console.error(e);
  app.exit(1);
});
