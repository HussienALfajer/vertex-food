import { whatsappKnownRecipients, whatsappSessionCredentials } from '@vertex-food/db';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CredentialsFencedError,
  DatabaseCredentialStore,
} from '../src/sessions/credential-store.js';
import { whatsappQrContext } from '../src/sessions/sessions.service.js';
import { FakeWhatsAppTransport } from '../src/transport/fake-transport.js';
import {
  ADMIN_PHONE,
  OTHER_NUMBER,
  STAFF_PHONE,
  SYRIAN_NUMBER,
  TURKISH_NUMBER,
} from './credentials.js';
import {
  addSession,
  crypto,
  db,
  events,
  hashOf,
  linkedSession,
  platformUser,
  relink,
  resetMessaging,
  session,
  unlink,
} from './fixtures.js';
import { type Gateway, startGateway } from './gateway.js';

let gateways: Gateway[] = [];
async function gateway(transport?: FakeWhatsAppTransport) {
  const started = await startGateway(transport);
  gateways.push(started);
  return started;
}

beforeEach(async () => {
  await resetMessaging();
});
afterEach(async () => {
  for (const started of gateways) await started.app.close();
  gateways = [];
});

describe('linking a number', () => {
  it('takes the lease, stores each QR sealed, and connects on a scan', async () => {
    const gw = await gateway();
    const id = await addSession('رقم سوري');
    await gw.tick();

    const linking = await session(id);
    expect(linking.state).toBe('linking');
    expect(linking.leaseHolder).not.toBeNull();
    expect(linking.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(linking.qrSealed).not.toContain('fake-qr');
    expect(crypto.box.open(whatsappQrContext(id), linking.qrSealed ?? '')).toBe('fake-qr-1');
    expect(linking.qrExpiresAt?.getTime()).toBeGreaterThan(Date.now());

    await gw.transport.scan(id, SYRIAN_NUMBER);
    await gw.settle();
    const linked = await session(id);
    expect(linked).toMatchObject({ state: 'connected', phone: SYRIAN_NUMBER, qrSealed: null });
    expect(linked.linkedAt).not.toBeNull();
    expect(linked.lastConnectedAt).not.toBeNull();
    expect(await events(id)).toEqual(['created', 'linked', 'connected']);
    expect(gw.sessions.runningIds()).toEqual([id]);
  });

  it('closes an unscanned link at its deadline', async () => {
    const gw = await gateway();
    const id = await addSession('رقم سوري');
    await gw.tick();
    await db.execute(
      sql`update whatsapp_sessions set link_deadline_at = now() - interval '1 second' where id = ${id}`,
    );
    await gw.tick();
    expect(await session(id)).toMatchObject({
      state: 'needs_relink',
      qrSealed: null,
      qrExpiresAt: null,
      leaseHolder: null,
    });
    expect(await events(id)).toEqual(['created', 'link_timeout']);
    expect(gw.transport.isConnected(id)).toBe(false);
    expect(gw.sessions.runningIds()).toEqual([]);
  });

  it('logs out a scan of a number another session holds, leaving that one untouched', async () => {
    const gw = await gateway();
    const first = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    const second = await addSession('رقم تركي');
    await gw.tick();
    await gw.transport.scan(second, SYRIAN_NUMBER);
    await gw.settle();

    expect(await session(second)).toMatchObject({ state: 'needs_relink', phone: null });
    expect(await events(second)).toEqual(['created', 'duplicate_number']);
    expect(gw.transport.loggedOut).toEqual([second]);
    expect((await session(second)).leaseHolder).toBeNull();
    expect(await session(first)).toMatchObject({ state: 'connected', phone: SYRIAN_NUMBER });
  });

  it('keeps linked_at on a re-link of the same phone and restarts it for another', async () => {
    const gw = await gateway();
    const id = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    await db.execute(
      sql`update whatsapp_sessions set linked_at = now() - interval '5 days' where id = ${id}`,
    );
    const warm = (await session(id)).linkedAt;
    await db.insert(whatsappKnownRecipients).values({
      id: uuidv7(),
      sessionId: id,
      recipientHash: hashOf(STAFF_PHONE),
      firstSentAt: sql`now()`,
      lastSentAt: sql`now()`,
    });

    await relink(id);
    await gw.tick();
    expect((await session(id)).state).toBe('linking');
    await gw.transport.scan(id, SYRIAN_NUMBER);
    await gw.settle();
    expect(await session(id)).toMatchObject({ state: 'connected', linkedAt: warm });
    const known = () =>
      db.select().from(whatsappKnownRecipients).where(eq(whatsappKnownRecipients.sessionId, id));
    expect(await known()).toHaveLength(1);

    await relink(id);
    await gw.tick();
    await gw.transport.scan(id, OTHER_NUMBER);
    await gw.settle();
    const relinked = await session(id);
    expect(relinked).toMatchObject({ state: 'connected', phone: OTHER_NUMBER });
    expect(relinked.linkedAt?.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await known()).toEqual([]);
  });
});

describe('the lease', () => {
  it('reconnects a restarted gateway from the sealed credentials, without a QR', async () => {
    const first = await gateway();
    const id = await linkedSession(first, 'رقم سوري', SYRIAN_NUMBER);
    const stored = await db
      .select()
      .from(whatsappSessionCredentials)
      .where(eq(whatsappSessionCredentials.sessionId, id));
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toMatch(/999000000001|fake\.account/);

    await first.app.close();
    gateways = [];
    expect((await session(id)).leaseHolder).toBeNull();

    const second = await gateway();
    await second.tick();
    expect(await session(id)).toMatchObject({ state: 'connected', qrSealed: null });
    expect(second.transport.isConnected(id)).toBe(true);
    expect(second.sessions.runningIds()).toEqual([id]);
  });

  it('lets one instance run a session; another takes it only once the lease expires', async () => {
    const transport = new FakeWhatsAppTransport();
    const a = await gateway(transport);
    const id = await linkedSession(a, 'رقم سوري', SYRIAN_NUMBER);
    const b = await gateway(transport);
    await b.tick();
    expect(b.sessions.runningIds()).toEqual([]);
    await a.tick();
    expect(a.sessions.runningIds()).toEqual([id]);

    // A stops renewing (its process hangs): B takes over after expiry, which replaces A's link.
    await db.execute(
      sql`update whatsapp_sessions set lease_expires_at = now() - interval '1 second' where id = ${id}`,
    );
    await b.tick();
    await a.settle();
    expect(b.sessions.runningIds()).toEqual([id]);
    expect(a.sessions.runningIds()).toEqual([]);
    expect((await session(id)).state).toBe('connected');
    // A never fights back: its next tick takes nothing.
    await a.tick();
    expect(a.sessions.runningIds()).toEqual([]);
  });

  it('closes a connection at once when a renewal fails', async () => {
    const gw = await gateway();
    const id = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    await db.execute(sql`update whatsapp_sessions set lease_holder = ${uuidv7()} where id = ${id}`);
    await gw.tick();
    expect(gw.transport.isConnected(id)).toBe(false);
    expect(gw.sessions.runningIds()).toEqual([]);
  });

  it('logs out a session an admin unlinked', async () => {
    const gw = await gateway();
    const id = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    await unlink(id);
    await gw.tick();
    expect(gw.transport.loggedOut).toEqual([id]);
    expect(gw.sessions.runningIds()).toEqual([]);
    expect((await session(id)).state).toBe('unlinked');
  });
});

describe('disconnects', () => {
  it('reconnects after a lost connection with backoff and records both events', async () => {
    const gw = await gateway();
    const id = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    gw.transport.disconnect(id, 'connection_lost');
    await gw.settle();
    expect(await session(id)).toMatchObject({
      state: 'disconnected',
      lastDisconnectReason: 'connection_lost',
    });
    expect(gw.transport.isConnected(id)).toBe(false);

    await vi.waitFor(() => expect(gw.transport.isConnected(id)).toBe(true), { timeout: 3000 });
    await gw.settle();
    expect((await session(id)).state).toBe('connected');
    expect(await events(id)).toEqual([
      'created',
      'linked',
      'connected',
      'disconnected:connection_lost',
      // The only number: the healthy count fell to zero and rose back (rule 29).
      'alert_sent:none_healthy',
      'connected',
      'alert_sent:healthy_again',
    ]);
  });

  it('reconnects at once after a restart request, without a state change', async () => {
    const gw = await gateway();
    const id = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    gw.transport.disconnect(id, 'restart_required');
    await gw.settle();
    expect(gw.transport.isConnected(id)).toBe(true);
    expect((await session(id)).state).toBe('connected');
    expect(await events(id)).toEqual(['created', 'linked', 'connected']);
  });

  it('stops in needs_relink when logged out and in banned when forbidden, alerting admins', async () => {
    await platformUser(ADMIN_PHONE);
    const gw = await gateway();
    const syrian = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    const turkish = await linkedSession(gw, 'رقم تركي', TURKISH_NUMBER);

    gw.transport.disconnect(syrian, 'logged_out');
    gw.transport.disconnect(turkish, 'forbidden');
    await gw.settle();
    expect(await session(syrian)).toMatchObject({
      state: 'needs_relink',
      lastDisconnectReason: 'logged_out',
      leaseHolder: null,
    });
    expect(await session(turkish)).toMatchObject({ state: 'banned', leaseHolder: null });
    expect(await events(syrian)).toContain('needs_relink:logged_out');
    expect(await events(syrian)).toContain('alert_sent:needs_relink');
    expect(await events(turkish)).toContain('banned:forbidden');
    expect(await events(turkish)).toContain('alert_sent:banned');
    expect(gw.sessions.runningIds()).toEqual([]);
    // Neither is taken again: they wait for an admin.
    await gw.tick();
    expect(gw.sessions.runningIds()).toEqual([]);
  });

  it('lets go of a session another connection replaced (440) and never reconnects it', async () => {
    const gw = await gateway();
    const id = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    gw.transport.disconnect(id, 'connection_replaced');
    await gw.settle();
    expect(gw.sessions.runningIds()).toEqual([]);
    expect((await session(id)).leaseHolder).toBeNull();
    await gw.tick();
    expect(gw.transport.isConnected(id)).toBe(false);
    expect(gw.sessions.runningIds()).toEqual([]);
    expect((await session(id)).state).toBe('connected');
  });
});

describe('the credential store', () => {
  it('refuses writes from a connection whose link moved on or whose lease is gone', async () => {
    const gw = await gateway();
    const id = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    const { leaseHolder, linkDeadlineAt } = await session(id);
    const store = (holder: string, epoch: Date | null) =>
      new DatabaseCredentialStore(db, crypto, id, holder, epoch);

    await expect(
      store(leaseHolder as string, linkDeadlineAt).set({ k: 'v' }),
    ).resolves.toBeUndefined();
    expect((await store(uuidv7(), null).get(['k'])).get('k')).toBe('v');
    await expect(store(uuidv7(), linkDeadlineAt).set({ k: 'w' })).rejects.toThrow(
      CredentialsFencedError,
    );
    await relink(id);
    await expect(store(leaseHolder as string, linkDeadlineAt).set({ k: 'w' })).rejects.toThrow(
      CredentialsFencedError,
    );
  });
});
