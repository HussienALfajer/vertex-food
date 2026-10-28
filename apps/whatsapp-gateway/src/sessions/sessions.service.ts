import {
  type BeforeApplicationShutdown,
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  canChangeWhatsAppSessionState,
  type DisconnectReason,
  type WhatsAppSessionEventType,
  type WhatsAppSessionState,
  whatsappPolicy,
} from '@vertex-food/contracts';
import {
  type Database,
  type MessagingCrypto,
  type Transaction,
  whatsappKnownRecipients,
  whatsappSessionEvents,
  whatsappSessions,
} from '@vertex-food/db';
import { and, eq, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { AlertsService } from '../alerts/alerts.service.js';
import { DATABASE, MESSAGING_CRYPTO } from '../core/database/database.module.js';
import { describeError } from '../core/log/describe-error.js';
import { Tasks } from '../core/tasks.js';
import { IncomingService } from '../incoming/incoming.service.js';
import { SendingService } from '../sending/sending.service.js';
import {
  type SessionEvents,
  type TransportConnection,
  WHATSAPP_TRANSPORT,
  type WhatsAppTransport,
} from '../transport/whatsapp-transport.js';
import { DatabaseCredentialStore } from './credential-store.js';
import { GATEWAY_INSTANCE, SessionRegistry } from './session-registry.js';
import { disconnectAction, reconnectDelay } from './session-state.js';

/** The sealing context of a session's current QR code, as the API opens it for the console. */
export function whatsappQrContext(sessionId: string): string {
  return `whatsapp-qr:${sessionId}`;
}

/** How long a stored QR code is shown: WhatsApp renews it about every 20 s (rule 4). */
const QR_TTL_SECONDS = 20;

/** The states a gateway runs a session in (rule 1); the others wait for an admin. */
const RUNNABLE: WhatsAppSessionState[] = ['linking', 'connected', 'disconnected'];

interface Running {
  id: string;
  /** The link this connection belongs to (`link_deadline_at`); a re-link sets another one. */
  epoch: Date | null;
  /** The stored state as this instance last wrote or read it. */
  state: WhatsAppSessionState;
  credentials: DatabaseCredentialStore;
  connection?: TransportConnection | undefined;
  /** Counts connects, so events of a replaced connection are ignored. */
  generation: number;
  /** Failed connections in a row, for the backoff; reset when the session opens. */
  failures: number;
  /** A restart was asked for since the session last opened: another one waits like a loss. */
  restarted: boolean;
  retry?: NodeJS.Timeout;
}

type SessionRow = {
  id: string;
  state: string;
  linkDeadlineAt: Date | null;
  linkExpired: boolean;
};

/**
 * The platform sessions this gateway instance runs (spec S03 rules 1–6, "Session states"), from
 * Vertex Shifa's gateway with the database lease it planned. Every 10 s (`tick`) the instance
 * renews its leases, closes a connection whose lease it lost, logs out a session an admin
 * unlinked, restarts one an admin re-linked, times out an unscanned link, then takes every free
 * or expired runnable session and connects it. Each connection reacts to its closing by the
 * disconnect table. Stored state is written only while the lease is held. Logs hold session ids
 * and reason codes, never a phone or a QR code.
 */
@Injectable()
export class SessionsService implements BeforeApplicationShutdown {
  private readonly logger = new Logger('Sessions');
  private readonly tasks = new Tasks(this.logger);
  private readonly running = new Map<string, Running>();
  /** Sessions another connection replaced (`440`): this instance never takes them again. */
  private readonly released = new Set<string>();
  private ticking: Promise<void> | undefined;
  private stopped = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MESSAGING_CRYPTO) private readonly crypto: MessagingCrypto,
    @Inject(WHATSAPP_TRANSPORT) private readonly transport: WhatsAppTransport,
    @Inject(GATEWAY_INSTANCE) private readonly instance: string,
    @Inject(SessionRegistry) private readonly registry: SessionRegistry,
    @Inject(forwardRef(() => SendingService)) private readonly sending: SendingService,
    @Inject(IncomingService) private readonly incoming: IncomingService,
    @Inject(AlertsService) private readonly alerts: AlertsService,
  ) {}

  /** Renews, checks and takes leases; one run at a time. */
  tick(): Promise<void> {
    this.ticking ??= (async () => {
      try {
        if (this.stopped) return;
        try {
          await this.renew();
        } catch (error) {
          // Rule 1: a renewal that failed closes every connection at once; another instance may
          // take the leases once they expire. They are taken again here once renewals work.
          this.logger.error(`Lease renewal failed: ${describeError(error)}`);
          for (const id of this.runningIds()) await this.letGo(id, 'lease_lost');
          return;
        }
        await this.take();
      } finally {
        this.ticking = undefined;
      }
    })();
    return this.ticking;
  }

  /** The sessions this instance runs now. */
  runningIds(): string[] {
    return [...this.running.keys()];
  }

  /** Waits for the work started by transport events and timers (tests, shutdown). */
  async settled(): Promise<void> {
    await this.ticking;
    await this.tasks.settled();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    await this.ticking;
    const sessions = [...this.running.values()];
    this.running.clear();
    for (const session of sessions) {
      clearTimeout(session.retry);
      this.registry.delete(session.id);
    }
    await Promise.all(sessions.map((session) => session.connection?.close()));
    await this.tasks.settled();
    await this.db
      .update(whatsappSessions)
      .set({ leaseHolder: null, leaseExpiresAt: null, updatedAt: sql`updated_at` })
      .where(eq(whatsappSessions.leaseHolder, this.instance));
  }

  private async renew(): Promise<void> {
    const held = [...this.running.keys()];
    if (held.length === 0) return;
    const renewed: SessionRow[] = await this.db
      .update(whatsappSessions)
      .set({ leaseExpiresAt: this.leaseUntil(), updatedAt: sql`updated_at` })
      .where(
        and(
          inArray(whatsappSessions.id, held),
          eq(whatsappSessions.leaseHolder, this.instance),
          isNull(whatsappSessions.archivedAt),
        ),
      )
      .returning(this.rowColumns());
    const kept = new Map(renewed.map((row) => [row.id, row]));
    const lost = held.filter((id) => !kept.has(id));
    if (lost.length > 0) {
      const archived = await this.db
        .select({ id: whatsappSessions.id })
        .from(whatsappSessions)
        .where(and(inArray(whatsappSessions.id, lost), eq(whatsappSessions.state, 'unlinked')));
      const unlinked = new Set(archived.map((row) => row.id));
      for (const id of lost) {
        if (!unlinked.has(id)) {
          await this.letGo(id, 'lease_lost');
          continue;
        }
        await this.letGo(id, 'unlinked');
        // The API keeps the lease on an unlinked session so its holder logs it out; done.
        await this.releaseLease(id);
      }
    }
    for (const row of renewed) {
      const session = this.running.get(row.id);
      if (!session) continue;
      const relinked =
        row.state === 'linking' &&
        (session.state !== 'linking' || row.linkDeadlineAt?.getTime() !== session.epoch?.getTime());
      if (relinked) {
        this.logger.log(`Session ${row.id} re-linked by an admin`);
        await this.letGo(row.id, 'relinked');
        await this.start(row);
      } else if (session.state === 'linking' && row.linkExpired) {
        await this.linkTimedOut(session);
      }
    }
  }

  private async take(): Promise<void> {
    if (this.stopped) return;
    const busy = [...this.running.keys(), ...this.released];
    const taken: SessionRow[] = await this.db
      .update(whatsappSessions)
      .set({
        leaseHolder: this.instance,
        leaseExpiresAt: this.leaseUntil(),
        updatedAt: sql`updated_at`,
      })
      .where(
        and(
          isNull(whatsappSessions.archivedAt),
          inArray(whatsappSessions.state, RUNNABLE),
          or(
            isNull(whatsappSessions.leaseHolder),
            lt(whatsappSessions.leaseExpiresAt, sql`now()`),
            // Its own, kept from before a failed renewal closed the connection.
            eq(whatsappSessions.leaseHolder, this.instance),
          ),
          busy.length > 0 ? notInArray(whatsappSessions.id, busy) : undefined,
        ),
      )
      .returning(this.rowColumns());
    for (const row of taken) {
      this.logger.log(`Session ${row.id} taken`);
      await this.start(row);
    }
  }

  private async start(row: SessionRow): Promise<void> {
    const session: Running = {
      id: row.id,
      epoch: row.linkDeadlineAt,
      state: row.state as WhatsAppSessionState,
      credentials: new DatabaseCredentialStore(
        this.db,
        this.crypto,
        row.id,
        this.instance,
        row.linkDeadlineAt,
      ),
      generation: 0,
      failures: 0,
      restarted: false,
    };
    this.running.set(row.id, session);
    if (session.state === 'linking' && row.linkExpired) {
      await this.linkTimedOut(session);
      return;
    }
    await this.connect(session);
  }

  /** Stops running a session here: logs it out when an admin unlinked it, else closes it. */
  private async letGo(id: string, why: 'unlinked' | 'lease_lost' | 'relinked'): Promise<void> {
    const session = this.running.get(id);
    if (!session) return;
    this.forget(session);
    if (why !== 'relinked') this.logger.log(`Session ${id} let go: ${why}`);
    if (!session.connection) return;
    try {
      if (why === 'unlinked') await session.connection.logout();
      else await session.connection.close();
    } catch (error) {
      this.logger.warn(`Session ${id} ${why} close failed: ${describeError(error)}`);
    }
  }

  private forget(session: Running): void {
    clearTimeout(session.retry);
    session.generation++;
    this.registry.delete(session.id);
    if (this.running.get(session.id) === session) this.running.delete(session.id);
  }

  private isCurrent(session: Running, generation: number): boolean {
    return this.running.get(session.id) === session && session.generation === generation;
  }

  private async connect(session: Running): Promise<void> {
    if (this.stopped) return;
    const generation = ++session.generation;
    try {
      const connection = await this.transport.connect(
        session.id,
        session.credentials,
        this.events(session, generation),
      );
      if (!this.isCurrent(session, generation)) {
        await connection.close();
        return;
      }
      session.connection = connection;
    } catch (error) {
      if (!this.isCurrent(session, generation)) return;
      this.logger.warn(`Session ${session.id} could not connect: ${describeError(error)}`);
      this.reconnectLater(session);
    }
  }

  private reconnectLater(session: Running): void {
    if (this.stopped) return;
    clearTimeout(session.retry);
    session.retry = setTimeout(
      () => this.tasks.run(`Session ${session.id} reconnect`, () => this.connect(session)),
      reconnectDelay(++session.failures),
    );
  }

  private events(session: Running, generation: number): SessionEvents {
    const id = session.id;
    const current = () => this.isCurrent(session, generation);
    return {
      qr: (code) => {
        if (current()) this.tasks.run(`Session ${id} QR`, () => this.storeQr(session, code));
      },
      open: ({ phone }) => {
        if (current()) {
          this.tasks.run(`Session ${id} open`, () => this.opened(session, generation, phone));
        }
      },
      close: (reason) => {
        if (current()) this.closed(session, reason);
      },
      message: (message) => {
        if (current()) {
          this.tasks.run(`Session ${id} incoming`, () => this.incoming.handle(id, message));
        }
      },
      receipt: (receipt) => {
        if (current()) {
          this.tasks.run(`Session ${id} receipt`, () => this.sending.receipt(id, receipt));
        }
      },
      sentText: (messageId) => this.sending.sentText(id, messageId),
    };
  }

  /** Rule 4: each QR, sealed, with its expiry; only while the stored state is `linking`. */
  private async storeQr(session: Running, code: string): Promise<void> {
    if (session.state !== 'linking') {
      // The stored link is gone (no account in the credentials): WhatsApp logged it out.
      await this.stop(session, 'needs_relink', 'logged_out');
      return;
    }
    await this.db
      .update(whatsappSessions)
      .set({
        qrSealed: this.crypto.box.seal(whatsappQrContext(session.id), code),
        qrExpiresAt: sql`now() + make_interval(secs => ${QR_TTL_SECONDS})`,
      })
      .where(this.held(session.id, ['linking']));
  }

  /** Rule 5 at a scan's first `open`, or a reconnect of a linked session. */
  private async opened(session: Running, generation: number, phone: string): Promise<void> {
    const linking = session.state === 'linking';
    const outcome = linking
      ? await this.link(session, phone)
      : await this.db.transaction(async (tx) => {
          const [row] = await tx
            .update(whatsappSessions)
            .set({ state: 'connected', lastConnectedAt: sql`now()` })
            .where(this.held(session.id, ['connected', 'disconnected']))
            .returning({ id: whatsappSessions.id });
          if (!row) return 'gone' as const;
          if (session.state === 'disconnected') await this.event(tx, session.id, 'connected');
          return 'connected' as const;
        });
    if (!this.isCurrent(session, generation)) return;
    if (outcome === 'gone') {
      await this.abandon(session);
      return;
    }
    if (outcome === 'duplicate') {
      this.logger.log(`Session ${session.id} scanned a number another session holds`);
      const connection = session.connection;
      this.forget(session);
      await connection?.logout();
      await this.releaseLease(session.id);
      return;
    }
    session.state = 'connected';
    session.failures = 0;
    session.restarted = false;
    if (session.connection) this.registry.set(session.id, session.connection);
    this.logger.log(`Session ${session.id} connected`);
    this.sending.wake();
    await this.alerts.checkHealth();
  }

  private async link(session: Running, phone: string): Promise<'linked' | 'duplicate' | 'gone'> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .select({ phone: whatsappSessions.phone, linkedAt: whatsappSessions.linkedAt })
          .from(whatsappSessions)
          .where(this.held(session.id, ['linking']))
          .for('update');
        if (!row) return 'gone';
        const [taken] = await tx
          .select({ id: whatsappSessions.id })
          .from(whatsappSessions)
          .where(
            and(
              eq(whatsappSessions.phone, phone),
              ne(whatsappSessions.id, session.id),
              isNull(whatsappSessions.archivedAt),
            ),
          );
        if (taken) {
          await this.markDuplicate(tx, session.id);
          return 'duplicate';
        }
        const samePhone = row.phone === phone;
        if (!samePhone && row.phone !== null) {
          // Another phone: the old one's known recipients go, the new one warms up from day 1.
          await tx
            .delete(whatsappKnownRecipients)
            .where(eq(whatsappKnownRecipients.sessionId, session.id));
        }
        await tx
          .update(whatsappSessions)
          .set({
            state: 'connected',
            phone,
            linkedAt: samePhone && row.linkedAt ? row.linkedAt : sql`now()`,
            qrSealed: null,
            qrExpiresAt: null,
            lastConnectedAt: sql`now()`,
          })
          .where(eq(whatsappSessions.id, session.id));
        await this.event(tx, session.id, 'linked');
        await this.event(tx, session.id, 'connected');
        return 'linked';
      });
    } catch (error) {
      // Two sessions scanned with one phone at once: the partial unique index decides.
      if (!isUniqueViolation(error)) throw error;
      await this.db.transaction((tx) => this.markDuplicate(tx, session.id));
      return 'duplicate';
    }
  }

  private async markDuplicate(tx: Transaction, id: string): Promise<void> {
    await tx
      .update(whatsappSessions)
      .set({ state: 'needs_relink', qrSealed: null, qrExpiresAt: null })
      .where(eq(whatsappSessions.id, id));
    await this.event(tx, id, 'duplicate_number');
  }

  private closed(session: Running, reason: DisconnectReason): void {
    session.connection = undefined;
    this.registry.delete(session.id);
    // A new generation, so a late event of the closed connection is ignored.
    session.generation++;
    const action = disconnectAction(reason);
    this.logger.log(`Session ${session.id} closed: ${reason}`);
    switch (action.kind) {
      case 'reconnect_now':
        if (session.restarted) {
          this.reconnectLater(session);
          return;
        }
        session.restarted = true;
        this.tasks.run(`Session ${session.id} restart`, () => this.connect(session));
        return;
      case 'reconnect_later':
        this.tasks.run(`Session ${session.id} disconnect`, () =>
          this.disconnected(session, reason),
        );
        this.reconnectLater(session);
        return;
      case 'stop':
        this.tasks.run(`Session ${session.id} stop`, () =>
          // A link that never opened cannot be banned: it needs a new scan.
          this.stop(session, session.state === 'linking' ? 'needs_relink' : action.state, reason),
        );
        return;
      case 'release':
        // Another connection holds the session: never fight it (`440`), the lease decides.
        this.forget(session);
        this.released.add(session.id);
        this.tasks.run(`Session ${session.id} release`, () => this.releaseLease(session.id));
        return;
    }
  }

  private async disconnected(session: Running, reason: DisconnectReason): Promise<void> {
    if (session.state !== 'connected') return;
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(whatsappSessions)
        .set({ state: 'disconnected', lastDisconnectReason: reason })
        .where(this.held(session.id, ['connected']))
        .returning({ id: whatsappSessions.id });
      if (row) await this.event(tx, session.id, 'disconnected', reason);
    });
    session.state = 'disconnected';
    await this.alerts.checkHealth();
  }

  /** Logged out, banned, or a QR for a session that had a link: stops here for an admin. */
  private async stop(
    session: Running,
    to: 'needs_relink' | 'banned',
    reason: DisconnectReason,
  ): Promise<void> {
    const from = session.state;
    const connection = session.connection;
    this.forget(session);
    if (!canChangeWhatsAppSessionState(from, to, 'gateway')) {
      await connection?.close();
      return;
    }
    const changed = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(whatsappSessions)
        .set({
          state: to,
          lastDisconnectReason: reason,
          qrSealed: null,
          qrExpiresAt: null,
          leaseHolder: null,
          leaseExpiresAt: null,
        })
        .where(this.held(session.id, [from]))
        .returning({ id: whatsappSessions.id });
      if (row) await this.event(tx, session.id, to, reason);
      return Boolean(row);
    });
    if (!changed) {
      await this.abandon(session, connection);
      return;
    }
    await connection?.close();
    this.logger.log(`Session ${session.id} is ${to}: ${reason}`);
    // A link the admin is watching in the console is not alerted (spec S03, "Alerts" note).
    if (from !== 'linking') await this.alerts.raise(session.id, to);
    await this.alerts.checkHealth();
  }

  /** Rule 4: three minutes without a scan close the link. */
  private async linkTimedOut(session: Running): Promise<void> {
    this.forget(session);
    await session.connection?.close();
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(whatsappSessions)
        .set({
          state: 'needs_relink',
          qrSealed: null,
          qrExpiresAt: null,
          leaseHolder: null,
          leaseExpiresAt: null,
        })
        .where(this.held(session.id, ['linking']))
        .returning({ id: whatsappSessions.id });
      if (row) await this.event(tx, session.id, 'link_timeout');
    });
    this.logger.log(`Session ${session.id} link timed out`);
  }

  /**
   * The stored session moved on under this connection (an admin re-linked or unlinked it, or the
   * lease went): logs the link out when unlinked, else closes it, and frees the lease at once so
   * the next tick runs it again without waiting for its expiry.
   */
  private async abandon(session: Running, connection = session.connection): Promise<void> {
    this.forget(session);
    const [row] = await this.db
      .select({ state: whatsappSessions.state })
      .from(whatsappSessions)
      .where(eq(whatsappSessions.id, session.id));
    const unlinked = row?.state === 'unlinked';
    try {
      if (unlinked) await connection?.logout();
      else await connection?.close();
    } catch (error) {
      this.logger.warn(`Session ${session.id} close failed: ${describeError(error)}`);
    }
    await this.releaseLease(session.id);
    this.logger.log(`Session ${session.id} let go: ${unlinked ? 'unlinked' : 'moved on'}`);
  }

  private async releaseLease(id: string): Promise<void> {
    await this.db
      .update(whatsappSessions)
      .set({ leaseHolder: null, leaseExpiresAt: null, updatedAt: sql`updated_at` })
      .where(and(eq(whatsappSessions.id, id), eq(whatsappSessions.leaseHolder, this.instance)));
  }

  /** This session, while this instance holds its lease, unarchived and in one of `states`. */
  private held(id: string, states: WhatsAppSessionState[]) {
    return and(
      eq(whatsappSessions.id, id),
      eq(whatsappSessions.leaseHolder, this.instance),
      isNull(whatsappSessions.archivedAt),
      inArray(whatsappSessions.state, states),
    );
  }

  private leaseUntil() {
    return sql`now() + make_interval(secs => ${whatsappPolicy.lease.ttlSeconds})`;
  }

  private rowColumns() {
    return {
      id: whatsappSessions.id,
      state: whatsappSessions.state,
      linkDeadlineAt: whatsappSessions.linkDeadlineAt,
      linkExpired: sql<boolean>`coalesce(${whatsappSessions.linkDeadlineAt} < now(), false)`,
    };
  }

  private async event(
    tx: Transaction,
    sessionId: string,
    type: WhatsAppSessionEventType,
    reason: string | null = null,
  ): Promise<void> {
    await tx.insert(whatsappSessionEvents).values({ id: uuidv7(), sessionId, type, reason });
  }
}

function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error && error.cause ? error.cause : error;
  return (cause as { code?: unknown } | null)?.code === '23505';
}
