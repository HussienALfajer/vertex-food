// Runs the scenarios (or a queue process) in Electron's main process, as the Windows app would.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';

// A queue process runs beside the scenario runner, another Electron app: give it its own profile so the two
// never share Chromium's user-data directory.
if (process.env.QUEUE_CONFIG) app.setPath('userData', join(tmpdir(), `vf-spike-printing-queue-${process.pid}`));

app.on('window-all-closed', () => {});
const entry = process.env.QUEUE_CONFIG ? '../scenarios/queue-child.mjs' : '../scenarios/run.mjs';
app
  .whenReady()
  .then(() => import(entry))
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
