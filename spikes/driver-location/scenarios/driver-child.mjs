// The driver app as its own process, so a scenario can kill it in the middle of a send and start it again.
// Usage: node driver-child.mjs <db file> <server url> <token> <run id>
import { makeDriver, testClock } from './driver.mjs';

const [file, url, token, run] = process.argv.slice(2);
const driver = makeDriver({ file, url, token, clock: testClock({ run }), timeoutMs: 10_000 });
const before = driver.outbox.counts();
const r = await driver.syncUntilEmpty({ maxAttempts: 10 });
process.stdout.write(`${JSON.stringify({ before, after: driver.outbox.counts(), ...r, requests: driver.requests })}\n`);
driver.close();
