// A restaurant PC's print queue in its own process, so a scenario can kill it in the middle of a send
// (TerminateProcess on Windows) and start it again. Configuration comes from QUEUE_CONFIG.
import { renderJob } from '../lib/jobs.mjs';
import { PrintQueue } from '../lib/queue.mjs';

const cfg = JSON.parse(process.env.QUEUE_CONFIG);
const q = new PrintQueue(cfg.file, { printers: cfg.printers, render: renderJob, backoffMs: [100] });
const say = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
q.on('sending', (j, bytes) => say({ ev: 'sending', id: j.id, bytes, maybePrinted: j.maybePrinted }));
q.on('printed', (j, r) => {
  say({ ev: 'printed', id: j.id, reprint: r.reprint });
  if (cfg.exitWhenDone && Object.keys(cfg.printers).every((p) => q.pending(p).length === 0)) q.stop().then(() => process.exit(0));
});
q.on('alert', (a) => say({ ev: 'alert', ...a }));
for (const j of cfg.enqueue ?? []) q.enqueue(j);
say({ ev: 'ready', pending: Object.keys(cfg.printers).flatMap((p) => q.pending(p).map((j) => ({ id: j.id, maybePrinted: j.maybePrinted }))) });
q.start();
