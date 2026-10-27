import { solveProofOfWork } from '@vertex-food/contracts';
import { api, unwrap } from '../../lib/api';

// Signing in to the console (spec S02 rules 38–39): public steps, each answering the signed,
// single-use ticket of the next one. Tickets stay in the screen's memory, never in a URL.

/** Phone and password or setup code, with a proof of work (ADR 0016) solved in the page. */
export async function signIn(
  credentials: { phone: string } & ({ password: string } | { setupCode: string }),
) {
  const proofOfWork = solveProofOfWork(await unwrap(api.POST('/api/auth/pow')));
  return unwrap(api.POST('/api/console/auth/sign-in', { body: { ...credentials, proofOfWork } }));
}

/** A TOTP code or a recovery code; answers the session's view and sets the cookie. */
export function verifyTotp(ticket: string, code: string) {
  return unwrap(api.POST('/api/console/auth/totp', { body: { ticket, code } }));
}

/** The first password and a code of the new TOTP secret; answers the recovery codes once. */
export function setUp(ticket: string, password: string, code: string) {
  return unwrap(api.POST('/api/console/auth/setup', { body: { ticket, password, code } }));
}
