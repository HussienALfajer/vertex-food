import {
  DomainError,
  HUB_SESSION_MAX_HOURS,
  type HubMembers,
  type HubPairing,
  type HubPairResult,
  type HubSession,
  isHubSessionActive,
  isPairingExpired,
  isPairingWindowOpen,
  type OpenPairing,
  type PairingKind,
  type PairingWindow,
  pairingPolicy,
  pairingRetryDelaySeconds,
  pinPolicy,
} from '@vertex-food/contracts';
import { sha256Hex } from '../canonical.js';
import type { JournalBody } from './journal.js';
import type { PeerActivity } from './peer.js';
import type {
  BranchData,
  HubClock,
  HubRandom,
  HubStore,
  MemberDirectory,
  PairingRecord,
  SessionRecord,
} from './ports.js';

// Pairing and PIN sessions on the hub (spec S04 rules 33–36, ADR 0035). Pairing is closed by
// default; a member with `hub.manage` opens it on the active hub for 2 minutes and one client; 5
// wrong codes close it and each address waits 1, 2, 4… s after a wrong code. Pairings, sessions and
// PIN lockouts are journal entries the hub copies to its standby; their use and revocations are
// merged both ways at every heartbeat, so either PC can revoke one offline and a failover keeps
// both.

const MINUTE_MS = 60 * 1000;
/** A pairing's last use is written at most once a minute; a session's last input every 15 s. */
const PAIRING_TOUCH_MS = MINUTE_MS;
const SESSION_TOUCH_MS = 15 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type OpenWindow = PairingWindow & { code: string; kind: PairingKind; name: string };

export type PairingDeps = {
  store: HubStore;
  clock: HubClock;
  random: HubRandom;
  members: MemberDirectory;
  branch: BranchData;
  /** The LAN addresses of both hub-capable PCs, for the pairing answer (rule 37). */
  peerAddresses: () => readonly string[];
  isHub: () => boolean;
  /** Journals a local entry under the writer lock and copies it to the standby. */
  appendLocal: (body: JournalBody) => Promise<void>;
  changed: () => void;
};

export class PairingDesk {
  private window: OpenWindow | null = null;
  private readonly addressFailures = new Map<string, { failures: number; retryAt: number }>();
  private readonly pinFailures = new Map<string, number>();

  constructor(private readonly deps: PairingDeps) {}

  private now(): Date {
    return this.deps.clock.now();
  }

  private requireManager(membershipId: string): void {
    const member = this.deps.members.member(membershipId);
    if (!member?.permissions.includes('hub.manage')) {
      throw new DomainError('FORBIDDEN', 'Pairing needs hub.manage');
    }
  }

  private requireHub(): void {
    if (!this.deps.isHub()) throw new DomainError('NOT_HUB', 'This PC is not the hub');
  }

  private async event(
    action:
      | 'hub_pairing.opened'
      | 'hub_pairing.paired'
      | 'hub_pairing.revoked'
      | 'hub_pairing.expired'
      | 'hub_session.pin_locked',
    fields: { membershipId?: string; pairingId?: string; details?: Record<string, string> },
  ): Promise<void> {
    await this.deps.store.transaction((tx) =>
      tx.recordLocalEvent({
        action,
        at: this.now().toISOString(),
        ...(fields.membershipId ? { membershipId: fields.membershipId } : {}),
        ...(fields.pairingId ? { pairingId: fields.pairingId } : {}),
        details: fields.details ?? {},
      }),
    );
  }

  /** Opens pairing for one client (rule 33); answers the code the screen shows. */
  async open(
    input: OpenPairing,
    byMembershipId: string,
  ): Promise<{ code: string; closesAt: Date }> {
    this.requireHub();
    this.requireManager(byMembershipId);
    const openedAt = this.now();
    const code = this.deps.random.pairingCode();
    this.window = {
      openedAt,
      closedAt: null,
      wrongCodes: 0,
      code,
      kind: input.kind,
      name: input.name,
    };
    await this.event('hub_pairing.opened', {
      membershipId: byMembershipId,
      details: { kind: input.kind },
    });
    return { code, closesAt: new Date(openedAt.getTime() + pairingPolicy.windowSeconds * 1000) };
  }

  close(): void {
    if (this.window && this.window.closedAt === null) this.window.closedAt = this.now();
  }

  /** While true, the hub serves the CA certificate on its plain-HTTP port (rule 37). */
  isOpen(): boolean {
    return this.window !== null && isPairingWindowOpen(this.window, this.now());
  }

  /** `POST /hub/pair` from `address`. */
  async pair(code: string, address: string): Promise<HubPairResult> {
    this.requireHub();
    const now = this.now();
    const failures = this.addressFailures.get(address);
    if (failures && now.getTime() < failures.retryAt) {
      throw new DomainError('PAIRING_LOCKED', 'Wait before the next code', {
        retryAfterSeconds: Math.ceil((failures.retryAt - now.getTime()) / 1000),
      });
    }
    const window = this.window;
    if (!window || !isPairingWindowOpen(window, now)) {
      throw new DomainError('PAIRING_CLOSED', 'Pairing is closed');
    }
    if (code !== window.code) {
      window.wrongCodes += 1;
      const count = (failures?.failures ?? 0) + 1;
      this.addressFailures.set(address, {
        failures: count,
        retryAt: now.getTime() + pairingRetryDelaySeconds(count) * 1000,
      });
      throw new DomainError('PAIRING_CODE_INVALID', 'Wrong pairing code');
    }
    // Single use: the window closes with the first pairing.
    window.closedAt = now;
    this.addressFailures.delete(address);
    const token = this.deps.random.token();
    const pairingId = this.deps.random.id();
    await this.deps.appendLocal({
      kind: 'hub.pairing',
      pairingId,
      pairingKind: window.kind,
      name: window.name,
      tokenHash: sha256Hex(token),
      createdAt: now.toISOString(),
    });
    await this.event('hub_pairing.paired', { pairingId, details: { kind: window.kind } });
    return {
      token,
      pairingId,
      kind: window.kind,
      peers: [...this.deps.peerAddresses()],
      caFingerprint: this.deps.branch.caFingerprint(),
    };
  }

  /**
   * The pairing of a request's token, or null (401). A pairing unused for 30 days ends (rule 34,
   * edge case 12).
   */
  async authenticate(token: string): Promise<PairingRecord | null> {
    const tokenHash = sha256Hex(token);
    const pairing = (await this.deps.store.pairings()).find((p) => p.tokenHash === tokenHash);
    if (!pairing || pairing.revokedAt !== null) return null;
    const now = this.now();
    if (isPairingExpired(new Date(pairing.lastUsedAt), now)) {
      await this.deps.store.transaction((tx) => tx.revokePairing(pairing.id, now.toISOString()));
      await this.event('hub_pairing.expired', { pairingId: pairing.id });
      this.deps.changed();
      return null;
    }
    if (now.getTime() - new Date(pairing.lastUsedAt).getTime() >= PAIRING_TOUCH_MS) {
      await this.deps.store.transaction((tx) => tx.touchPairing(pairing.id, now.toISOString()));
    }
    return pairing;
  }

  /** `GET /hub/members`: names and roles only, never verifiers (rule 35). */
  membersFor(pairing: PairingRecord): HubMembers {
    if (pairing.kind !== 'personal') throw new DomainError('FORBIDDEN', 'A station has no members');
    return {
      members: this.deps.members
        .members()
        .map((m) => ({ membershipId: m.membershipId, name: m.name, roles: m.roles })),
    };
  }

  /** `POST /hub/sessions`: a PIN session, with S02's lockout shared with the standby. */
  async startSession(
    pairing: PairingRecord,
    input: { membershipId: string; pin: string },
  ): Promise<HubSession> {
    this.requireHub();
    if (pairing.kind !== 'personal')
      throw new DomainError('FORBIDDEN', 'A station has no sessions');
    const member = this.deps.members.member(input.membershipId);
    if (!member) throw new DomainError('INVALID_PIN', 'Wrong PIN');
    if (member.pinDisabled || (await this.deps.store.pinDisabled(member.membershipId))) {
      throw new DomainError('PIN_DISABLED', 'This PIN is disabled');
    }
    if (
      member.pinVerifier === null ||
      !(await this.deps.members.verifyPin(member.pinVerifier, input.pin))
    ) {
      const failures = (this.pinFailures.get(member.membershipId) ?? 0) + 1;
      this.pinFailures.set(member.membershipId, failures);
      if (failures < pinPolicy.maxLocalFailures) throw new DomainError('INVALID_PIN', 'Wrong PIN');
      this.pinFailures.delete(member.membershipId);
      await this.deps.appendLocal({
        kind: 'hub.pin_disabled',
        membershipId: member.membershipId,
        at: this.now().toISOString(),
      });
      await this.event('hub_session.pin_locked', {
        membershipId: member.membershipId,
        pairingId: pairing.id,
      });
      throw new DomainError('PIN_DISABLED', 'This PIN is disabled');
    }
    this.pinFailures.delete(member.membershipId);
    const token = this.deps.random.token();
    const startedAt = this.now();
    await this.deps.appendLocal({
      kind: 'hub.session',
      sessionId: this.deps.random.id(),
      pairingId: pairing.id,
      membershipId: member.membershipId,
      tokenHash: sha256Hex(token),
      startedAt: startedAt.toISOString(),
    });
    return {
      token,
      membershipId: member.membershipId,
      name: member.name,
      permissions: member.permissions,
      idleLockMinutes: this.deps.branch.idleLockMinutes(),
      expiresAt: new Date(
        startedAt.getTime() + HUB_SESSION_MAX_HOURS * 60 * MINUTE_MS,
      ).toISOString(),
    };
  }

  /**
   * The active session of a token on a pairing, or null: it ends after the branch's idle lock
   * without input or 12 hours (rule 35). A command counts as input.
   */
  async session(pairing: PairingRecord, token: string): Promise<SessionRecord | null> {
    const tokenHash = sha256Hex(token);
    const session = (await this.deps.store.sessions()).find(
      (s) => s.tokenHash === tokenHash && s.pairingId === pairing.id,
    );
    if (!session || session.endedAt !== null) return null;
    const now = this.now();
    const active = isHubSessionActive(
      {
        startedAt: new Date(session.startedAt),
        lastInputAt: new Date(session.lastInputAt),
        idleLockMinutes: this.deps.branch.idleLockMinutes(),
      },
      now,
    );
    if (!active) return null;
    if (now.getTime() - new Date(session.lastInputAt).getTime() >= SESSION_TOUCH_MS) {
      await this.deps.store.transaction((tx) => tx.touchSession(session.id, now.toISOString()));
    }
    return session;
  }

  /** `DELETE /hub/sessions/current`. */
  async endSession(pairing: PairingRecord, token: string): Promise<void> {
    const session = await this.session(pairing, token);
    if (session) {
      await this.deps.store.transaction((tx) =>
        tx.endSession(session.id, this.now().toISOString()),
      );
    }
  }

  /** Revokes a pairing on either hub-capable PC, offline too (rule 34). */
  async revoke(pairingId: string, byMembershipId: string): Promise<void> {
    this.requireManager(byMembershipId);
    const pairing = (await this.deps.store.pairings()).find((p) => p.id === pairingId);
    if (!pairing) throw new DomainError('NOT_FOUND', 'No such pairing');
    if (pairing.revokedAt !== null) return;
    await this.deps.store.transaction((tx) =>
      tx.revokePairing(pairingId, this.now().toISOString()),
    );
    await this.event('hub_pairing.revoked', { membershipId: byMembershipId, pairingId });
    this.deps.changed();
  }

  /** The paired clients for the branch network screen and the live snapshot. */
  async list(): Promise<HubPairing[]> {
    const now = this.now();
    return (await this.deps.store.pairings())
      .filter((p) => p.revokedAt === null && !isPairingExpired(new Date(p.lastUsedAt), now))
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        name: p.name,
        createdAt: p.createdAt,
        lastUsedAt: p.lastUsedAt,
      }));
  }

  /** What this PC tells its peer at a heartbeat: recent use and revocations. */
  async activity(): Promise<PeerActivity> {
    const now = this.now().getTime();
    const pairings = (await this.deps.store.pairings())
      .filter(
        (p) =>
          p.revokedAt === null ||
          now - Date.parse(p.revokedAt) < pairingPolicy.idleExpiryDays * DAY_MS,
      )
      .map((p) => ({ id: p.id, lastUsedAt: p.lastUsedAt, revokedAt: p.revokedAt }));
    const sessions = (await this.deps.store.sessions())
      .filter((s) => now - Date.parse(s.startedAt) < HUB_SESSION_MAX_HOURS * 60 * MINUTE_MS)
      .map((s) => ({ id: s.id, lastInputAt: s.lastInputAt, endedAt: s.endedAt }));
    return { pairings: pairings.slice(-500), sessions: sessions.slice(-2000) };
  }

  /** Takes the later use and every revocation or end the peer saw. */
  async mergeActivity(theirs: PeerActivity): Promise<void> {
    const pairings = new Map((await this.deps.store.pairings()).map((p) => [p.id, p]));
    const sessions = new Map((await this.deps.store.sessions()).map((s) => [s.id, s]));
    const work: ((tx: Parameters<Parameters<HubStore['transaction']>[0]>[0]) => Promise<void>)[] =
      [];
    let revoked = false;
    for (const p of theirs.pairings) {
      const mine = pairings.get(p.id);
      if (!mine) continue;
      if (p.lastUsedAt > mine.lastUsedAt) work.push((tx) => tx.touchPairing(p.id, p.lastUsedAt));
      if (p.revokedAt !== null && mine.revokedAt === null) {
        revoked = true;
        work.push((tx) => tx.revokePairing(p.id, p.revokedAt as string));
      }
    }
    for (const s of theirs.sessions) {
      const mine = sessions.get(s.id);
      if (!mine) continue;
      if (s.lastInputAt > mine.lastInputAt) work.push((tx) => tx.touchSession(s.id, s.lastInputAt));
      if (s.endedAt !== null && mine.endedAt === null) {
        work.push((tx) => tx.endSession(s.id, s.endedAt as string));
      }
    }
    if (work.length === 0) return;
    await this.deps.store.transaction(async (tx) => {
      for (const step of work) await step(tx);
    });
    if (revoked) this.deps.changed();
  }
}
