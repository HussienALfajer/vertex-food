import type { INestApplication } from '@nestjs/common';
import type { ConsoleRole } from '@vertex-food/contracts';
import { expect, vi } from 'vitest';
import { PlatformUsersService } from '../src/modules/platform/identity/index.js';
import { totpCode, totpStep } from '../src/modules/platform/identity/totp.js';
import { client, newPhone, OPERATOR, PASSWORD, proofOfWork } from './staff.js';

// Console sessions over HTTP for the integration tests of console routes (spec S02 rules 38–41):
// a platform user made by the CLI's service and set up through the routes, its requests from the
// console's origin, and its TOTP re-entry. Files using it run with a fake `Date`.

export const CONSOLE_ORIGIN = 'http://localhost:5274';

export type ConsoleUser = { userId: string; name: string; secret: string; cookie: string };

/** Moves the clock to the next TOTP step, so a new code is never a used step. */
function nextStep() {
  vi.setSystemTime(Date.now() + 30_000);
}

/** A platform user of `role`, signed in after its setup (which counts as a TOTP entry). */
export async function consoleUser(app: INestApplication, role: ConsoleRole): Promise<ConsoleUser> {
  const name = `موظف ${role}`;
  const created = await app.get(PlatformUsersService).create(OPERATOR, {
    phone: newPhone(),
    name,
    role,
    grantedPermissions: [],
    revokedPermissions: [],
  });
  const solved = await proofOfWork(app);
  const signIn = await client(app)
    .post('/api/console/auth/sign-in')
    .send({ phone: created.user.phone, setupCode: created.setupCode, proofOfWork: solved })
    .expect(200);
  expect(signIn.body.step).toBe('setup');
  const secret = signIn.body.totpSecret as string;
  const setup = await client(app)
    .post('/api/console/auth/setup')
    .send({
      ticket: signIn.body.ticket,
      password: PASSWORD,
      code: totpCode(secret, totpStep(new Date())),
    })
    .expect(200);
  const cookie = (setup.headers['set-cookie'] as unknown as string[]).find((value) =>
    value.startsWith('__Secure-vf-console='),
  );
  if (!cookie) throw new Error('No console cookie');
  return { userId: created.user.id, name, secret, cookie: cookie.split(';')[0] as string };
}

/** Requests as the user, writes from the console's origin. */
export function asConsoleUser(app: INestApplication, user: ConsoleUser) {
  const http = client(app);
  return {
    get: (path: string) => http.get(path).set('cookie', user.cookie),
    post: (path: string) =>
      http.post(path).set('cookie', user.cookie).set('origin', CONSOLE_ORIGIN),
  };
}

/** A TOTP re-entry (rule 40): sensitive console actions are allowed for 5 minutes. */
export async function reauthenticate(app: INestApplication, user: ConsoleUser) {
  nextStep();
  await asConsoleUser(app, user)
    .post('/api/console/auth/reauth')
    .send({ code: totpCode(user.secret, totpStep(new Date())) })
    .expect(200);
}
