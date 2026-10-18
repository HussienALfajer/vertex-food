// Runs the scenarios (or a queue process) in Electron's main process, as the Windows app would.
import { app } from 'electron';

app.on('window-all-closed', () => {});
const entry = process.env.QUEUE_CONFIG ? '../scenarios/queue-child.mjs' : '../scenarios/run.mjs';
app
  .whenReady()
  .then(() => import(entry))
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
