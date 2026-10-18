// Manual demo for a real phone or kitchen screen on the same Wi-Fi: starts the hub and the standby on the LAN
// address and prints what to open. Needs docker compose up -d and `pnpm server`. Stop with Ctrl+C.
// Windows asks once whether Node may accept connections on private networks: allow it for this test.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IDS, BUSINESS_DAY, CURRENCY } from '../server/seed.mjs';
import { createBranchCa, issueHubCert, lanAddresses, fingerprint } from '../pc/tls.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.data', 'demo');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
await fetch('http://127.0.0.1:6070/api/spike/reset', { method: 'POST' });

const ip = lanAddresses().find((a) => a.startsWith('192.168.') || a.startsWith('10.')) ?? '127.0.0.1';
const ca = createBranchCa('Vertex Food branch CA (spike demo)');
const peerSecret = crypto.randomBytes(24).toString('hex');
const pcs = [['cashier-1', IDS.pc1, 7443, 7543, 'hub'], ['cashier-2', IDS.pc2, 7444, 7544, 'standby']].map(([name, deviceId, lanPort, ctlPort, preferredRole]) => {
  const cert = issueHubCert(ca, name);
  return {
    name, deviceId, tenantId: IDS.tenantA, branchId: IDS.branchA, dir, hexKey: crypto.randomBytes(32).toString('hex'), lanPort, ctlPort,
    lanHost: process.env.LAN_HOST ?? '0.0.0.0', apiPort: 6070, syncPort: 8095, preferredRole, businessDay: BUSINESS_DAY, currency: CURRENCY, caPem: ca.certPem,
    certPem: cert.certPem, keyPem: cert.keyPem, peerSecret, cashierUserId: IDS.cashier,
  };
});
pcs[0].peers = [{ name: pcs[1].name, deviceId: pcs[1].deviceId, url: `https://127.0.0.1:${pcs[1].lanPort}` }];
pcs[1].peers = [{ name: pcs[0].name, deviceId: pcs[0].deviceId, url: `https://127.0.0.1:${pcs[0].lanPort}` }];
for (const cfg of pcs) {
  const cfgPath = path.join(dir, `${cfg.name}.json`);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  spawn(process.execPath, [path.join(root, 'pc', 'pc.mjs')], { env: { ...process.env, PC_CONFIG: cfgPath }, stdio: ['ignore', 'ignore', 'inherit'] });
  await new Promise((r) => setTimeout(r, 1500));
}
fs.writeFileSync(path.join(dir, 'branch-ca.pem'), ca.certPem);
// What a manager does on the hub's screen: open pairing for 2 minutes.
const opened = await (await fetch('http://127.0.0.1:7543/ctl/open-pairing', { method: 'POST', body: '{}' })).json();
console.log(`
Kitchen display: https://${ip}:7443/kds
Waiter:          https://${ip}:7443/waiter
Pairing code:    ${opened.code}   (2 minutes, single use; a new one: curl -X POST http://127.0.0.1:7543/ctl/open-pairing)
Branch CA:       ${path.join(dir, 'branch-ca.pem')}
CA fingerprint:  ${fingerprint(ca.certPem)}
Cut the internet: curl -X POST -d "{\\"online\\":false}" http://127.0.0.1:7543/ctl/internet
`);
