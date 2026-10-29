import {
  type DeviceMember,
  deviceTokenMessage,
  deviceTokenTtlSeconds,
  type MemberList,
  type SessionTokens,
  staffSessionPolicy,
} from '@vertex-food/contracts';
import type {
  ApproveInput,
  BridgeResult,
  DeviceStatus,
  LockReason,
  PasswordSignInInput,
  ReenableInput,
  RegisterInput,
  SignInInput,
} from './bridge.js';
import { type DeviceApi, DeviceApiError, isUnreachable } from './device-client.js';
import type { DeviceKey } from './device-key.js';
import type { DeviceRecord, DeviceStore, Registration, StoredRecord } from './device-store.js';
import {
  approveLocally,
  checkPinLocally,
  clearLocalLockout,
  countFailure,
  type LocalOutcome,
  localMember,
  pinDisabledHere,
  recordSession,
  reenableLocally,
  seeTime,
  signInOffline,
  type VerifyPin,
  windowOf,
} from './local-pins.js';
import type { LocalData } from './local-store.js';

type Registered = Extract<DeviceRecord, { state: 'registered' }>;
type Wiping = Extract<DeviceRecord, { state: 'wiping' }>;
type StoredRegistered = Extract<StoredRecord, { state: 'registered' }>;

/**
 * A PIN session; an online one holds its tokens and when its access token is due, on the
 * monotonic clock (`elapsed`).
 */
type Session = {
  membershipId: string;
  tokens: SessionTokens | null;
  accessDueAt: number;
  /**
   * Opened by password to replace a forgotten PIN (rule 22): the verifier the member list held
   * then, so a list with another one shows the new PIN was set.
   */
  replacing?: { pinVerifier: string | null };
};

export type DeviceServiceDeps = {
  store: DeviceStore;
  client: DeviceApi;
  verifyPin: VerifyPin;
  generateKey: () => DeviceKey;
  sign: (privateKey: string, message: string) => string;
  /** The PC's clock: the offline window and the times it records (rules 30, 31). */
  now: () => Date;
  /**
   * Milliseconds on a monotonic clock. Token lifetimes are measured on it from when they arrived,
   * never against the server's `expiresAt`: a PC clock that is off, or set back, keeps signing in.
   */
  elapsed: () => number;
  os: string;
  appVersion: string;
  /** The status may have changed: the renderer reads it again. */
  onChange: () => void;
  /**
   * The local database of a registration, with its key (spec S04 "On the PC"): one per device id,
   * so a PC registered again never meets the file of a key it lost.
   */
  openData: (deviceId: string, databaseKey: string) => Promise<LocalData>;
  generateDatabaseKey: () => string;
  /**
   * Spec S04 rule 40: a revoked PC's pending commands go to the quarantine before its database is
   * deleted. It throws until the upload succeeds; the wipe waits and tries again at the next
   * member-list refresh.
   */
  quarantine: (registration: Registration, data: LocalData) => Promise<void>;
  /** The local database of a registered PC is open: the sync client starts on it. */
  onData?: (registration: Registration, data: LocalData) => void;
};

/** A device token is fetched again this long before it expires. */
const TOKEN_MARGIN_MS = 30_000;

/** An access token is refreshed this long before it expires. */
const ACCESS_MARGIN_MS = 60_000;

function codeOf(error: unknown): string {
  return error instanceof DeviceApiError ? error.code : 'INTERNAL_ERROR';
}

/**
 * The membership of an access token, from its payload (`mid`). The token came from the API over
 * TLS and the server verifies it on every use; the PC reads it only to know whose session it is.
 */
export function membershipOfAccessToken(token: string): string | null {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    const mid = (payload as { mid?: unknown }).mid;
    return typeof mid === 'string' ? mid : null;
  } catch {
    return null;
  }
}

/**
 * The PC's identity in the main process (spec S02 rules 16–33): registration, device tokens, the
 * member list and its offline window, PIN sessions online and offline, approvals, the wipe. Every
 * operation runs one at a time, so two writes of the sealed record never interleave.
 */
export class DeviceService {
  private record: DeviceRecord | null = null;
  private session: Session | null = null;
  private deviceToken: { token: string; dueAt: number } | null = null;
  private online = false;
  private queue: Promise<unknown> = Promise.resolve();
  private data: LocalData | null = null;
  /** The members as last written to the local database, compared by reference. */
  private persisted: Pick<Registered, 'memberList' | 'local'> | null = null;
  /** Server time minus this PC's time, from the last heartbeat (spec S04 rule 14). */
  private clockOffsetMs: number | null = null;

  private constructor(private readonly deps: DeviceServiceDeps) {}

  /** Reads the sealed record and opens the local database of a registered or wiping PC. */
  static async open(deps: DeviceServiceDeps): Promise<DeviceService> {
    const service = new DeviceService(deps);
    await service.load();
    return service;
  }

  private async load(): Promise<void> {
    const stored = this.deps.store.read();
    if (stored?.state !== 'registered') {
      this.record = stored;
      const key =
        stored?.state === 'wiping' && !stored.quarantined && stored.registration.databaseKey;
      if (key) {
        this.data = await this.deps.openData(stored.registration.deviceId, key).catch(() => null);
      }
      return;
    }
    this.clockOffsetMs = stored.clockOffsetMs ?? null;
    await this.attach(stored);
  }

  /**
   * Opens the local database of a registered PC and takes its members from it (S02 rule 29). A
   * PC registered before S04 first gets its database key, then its list moves out of the sealed
   * file: written to the database first, then left out of the file, so a cut between the two
   * repeats the move at the next start. Members whose rows disagree with the list's version (a cut
   * write) are kept, but the next refresh fetches the whole list again.
   */
  private async attach(input: StoredRegistered): Promise<void> {
    const databaseKey = input.registration.databaseKey ?? this.deps.generateDatabaseKey();
    const stored = { ...input, registration: { ...input.registration, databaseKey } };
    if (!input.registration.databaseKey) this.deps.store.write(stored);
    const data = await this.deps.openData(stored.registration.deviceId, databaseKey);
    this.data = data;
    const sealed = stored.memberList.members;
    // A database that cannot be read leaves the PC with the list's header and no members until
    // the next list arrives; it still opens.
    const loaded = sealed ? null : await data.loadMembers().catch(() => null);
    const record: Registered = {
      ...stored,
      memberList: {
        ...stored.memberList,
        members: sealed ?? loaded?.members ?? [],
        version:
          sealed || loaded?.version === stored.memberList.version ? stored.memberList.version : '',
      },
      local: stored.local ?? loaded?.local ?? {},
    };
    this.record = record;
    if (!sealed) this.persisted = record;
    else if (data.state === 'ok') await this.save(record);
    this.deps.onData?.(stored.registration, data);
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * Writes the record. The highest time seen never goes down here: an operation that read the
   * record before awaiting the API keeps what `status` saw meanwhile (rule 31). Only a confirmed
   * member list sets it from the server's time (`clockFromServer`, `withList`).
   */
  private async save(
    record: DeviceRecord,
    options: { clockFromServer?: boolean } = {},
  ): Promise<void> {
    const current = this.registered();
    const next =
      record.state === 'registered' && current && !options.clockFromServer
        ? seeTime(record, new Date(current.highestSeenAt))
        : record;
    if (next.state === 'registered' && this.data?.state === 'ok' && this.membersChanged(next)) {
      await this.data.saveMembers({
        version: next.memberList.version,
        members: next.memberList.members,
        local: next.local,
      });
      this.persisted = next;
    }
    this.deps.store.write(this.stored(next));
    this.record = next;
  }

  private membersChanged(record: Registered): boolean {
    const persisted = this.persisted;
    return (
      persisted?.memberList.members !== record.memberList.members ||
      persisted.memberList.version !== record.memberList.version ||
      persisted.local !== record.local
    );
  }

  /**
   * The sealed file's part of a record: without the members while the local database holds them;
   * with them while it cannot be written (S02's file, until the database opens whole).
   */
  private stored(record: DeviceRecord): StoredRecord {
    if (record.state !== 'registered') return record;
    const withClock = { ...record, clockOffsetMs: this.clockOffsetMs };
    if (this.data?.state !== 'ok') return withClock;
    const { members: _members, ...header } = record.memberList;
    const { local: _local, ...rest } = withClock;
    return { ...rest, memberList: header };
  }

  /**
   * Rule 31: every look at the PC's clock raises the highest time seen and keeps it, so a clock
   * set back later, even before any PIN is typed or a restart, never reopens the window. The
   * write is synchronous, so it never interleaves with an operation's. A write that fails (a file
   * held by an antivirus scan) keeps the time in memory and is tried again at the next look; the
   * window shown already counts from it.
   */
  private observe(now: Date): void {
    const record = this.registered();
    if (!record || now.getTime() <= Date.parse(record.highestSeenAt)) return;
    const seen = seeTime(record, now);
    try {
      // The members are unchanged: only the sealed file is written, synchronously.
      this.deps.store.write(this.stored(seen));
      this.record = seen;
    } catch {
      this.record = seen;
    }
  }

  private registered(): Registered | null {
    return this.record?.state === 'registered' ? this.record : null;
  }

  status(): DeviceStatus {
    const now = this.deps.now();
    this.observe(now);
    const record = this.record;
    if (!record) return { state: 'unregistered' };
    if (record.state !== 'registered') return { state: 'wiped', tenantName: record.tenantName };
    const { memberList } = record;
    return {
      state: 'registered',
      tenant: memberList.tenant,
      branch: memberList.branch,
      device: memberList.device,
      members: memberList.members.map((member) => ({
        membershipId: member.membershipId,
        name: member.name,
        roles: member.roles,
        permissions: member.permissions,
        hasPin: member.pinVerifier !== null,
        pinDisabledOnline: member.pinDisabled,
        pinDisabledHere: localMember(record, member.membershipId).disabled,
        usedThisDevice: localMember(record, member.membershipId).firstSessionAt !== null,
      })),
      window: windowOf(record, now),
      online: this.online,
      ...(this.data?.state === 'corrupt' ? { localDatabase: 'corrupt' as const } : {}),
      session: this.session
        ? {
            membershipId: this.session.membershipId,
            online: this.session.tokens !== null,
            choosePin: this.session.replacing !== undefined,
          }
        : null,
    };
  }

  /** Rule 16: one registration per installation (rule 17). */
  register(input: RegisterInput): Promise<BridgeResult> {
    return this.run(async () => {
      if (this.record) return { ok: false, code: 'FORBIDDEN' };
      // The key must be storable before the server registers it: a registration whose key is lost
      // leaves an active device no one can sign for (rules 16, 21).
      if (!this.deps.store.canWrite()) return { ok: false, code: 'INTERNAL_ERROR' };
      const key = this.deps.generateKey();
      try {
        const result = await this.deps.client.register(input.ticket, {
          tenantId: input.tenantId,
          branchId: input.branchId,
          name: input.name,
          publicKey: key.publicKey,
          os: this.deps.os,
          appVersion: this.deps.appVersion,
        });
        const now = this.deps.now();
        const registration: Registration = {
          tenantId: input.tenantId,
          branchId: input.branchId,
          deviceId: result.device.id,
          privateKey: key.privateKey,
          publicKey: key.publicKey,
          databaseKey: this.deps.generateDatabaseKey(),
        };
        this.online = true;
        const registered = this.withList(registration, result.members);
        const membershipId = membershipOfAccessToken(result.session.accessToken);
        const record = membershipId ? recordSession(registered, membershipId, now) : registered;
        // Saved at once, with the keys, in the sealed file; the registering member's session
        // follows from the token.
        await this.save(record);
        if (membershipId) this.session = this.onlineSession(membershipId, result.session);
        // Then the members move into the local database; a failure leaves them sealed until the
        // next start opens it.
        await this.attach(record).catch(() => undefined);
        return { ok: true };
      } catch (error) {
        if (isUnreachable(error)) this.online = false;
        return { ok: false, code: codeOf(error) };
      } finally {
        this.deps.onChange();
      }
    });
  }

  private onlineSession(membershipId: string, tokens: SessionTokens): Session {
    return {
      membershipId,
      tokens,
      accessDueAt:
        this.deps.elapsed() + staffSessionPolicy.accessTokenMinutes * 60_000 - ACCESS_MARGIN_MS,
    };
  }

  /**
   * A confirmed member list. The highest time seen starts again from the server's time: the server
   * is the authority at that moment, so a PC clock that once ran ahead does not keep the window
   * closed (rules 30, 31); between syncs the PC's clock only raises it.
   */
  private withList(registration: Registration, list: MemberList): Registered {
    const previous = this.registered();
    return {
      state: 'registered',
      registration,
      memberList: list,
      membersSyncedAt: list.issuedAt,
      highestSeenAt: list.issuedAt,
      local: previous?.local ?? {},
    };
  }

  /**
   * Runs a device route with a device token; a token the server no longer accepts (expired on
   * its side, or the API restarted with new keys) is fetched again once.
   */
  private async withToken<T>(
    registration: Registration,
    call: (token: string) => Promise<T>,
  ): Promise<T> {
    try {
      return await call(await this.token(registration));
    } catch (error) {
      if (codeOf(error) !== 'UNAUTHENTICATED') throw error;
      this.deviceToken = null;
      return call(await this.token(registration));
    }
  }

  /**
   * A sync route's call with a device token (spec S04), outside the queue so an upload never holds
   * up a PIN. A revoked PC starts its wipe (rule 40); the error goes back to the caller.
   */
  async deviceCall<T>(call: (token: string) => Promise<T>): Promise<T> {
    const record = this.registered();
    if (!record) throw new DeviceApiError('DEVICE_UNKNOWN');
    try {
      const result = await this.withToken(record.registration, call);
      this.online = true;
      return result;
    } catch (error) {
      if (isUnreachable(error)) this.online = false;
      if (codeOf(error) === 'DEVICE_REVOKED') void this.revoked();
      throw error;
    }
  }

  /** The PC learned it was revoked outside the member list: it wipes (rule 19, spec S04 rule 40). */
  revoked(): Promise<void> {
    return this.run(async () => {
      const record = this.registered();
      if (!record) return;
      await this.wipe(record);
      this.deps.onChange();
    });
  }

  /**
   * Spec S04 rule 14: the offset a heartbeat measured, kept with the highest time seen, which the
   * server's time raises (S02 rule 31). Written synchronously, like `observe`.
   */
  recordServerTime(serverTime: Date, offsetMs: number): void {
    const record = this.registered();
    if (!record) return;
    this.clockOffsetMs = offsetMs;
    const seen = seeTime(record, serverTime);
    this.record = seen;
    try {
      this.deps.store.write(this.stored(seen));
    } catch {
      // Kept in memory; the next write carries it.
    }
  }

  /** What every command this PC signs carries about its clock (spec S04 rules 3, 14). */
  clock(): { offsetMs: number | null; highestSeenTime: Date } | null {
    const record = this.registered();
    return record
      ? { offsetMs: this.clockOffsetMs, highestSeenTime: new Date(record.highestSeenAt) }
      : null;
  }

  /** The branch's members as this PC holds them, with their verifiers: the hub's member list. */
  members(): readonly DeviceMember[] {
    return this.registered()?.memberList.members ?? [];
  }

  /** The member of the PIN session open on this PC, or null. */
  sessionMember(): string | null {
    return this.session?.membershipId ?? null;
  }

  /** The offline window closed (S02 rule 30): commands made now carry `afterOfflineWindow`. */
  afterOfflineWindow(): boolean {
    const record = this.registered();
    return record ? !windowOf(record, this.deps.now()).open : false;
  }

  /** Spec S04 rule 27: a PIN typed on this PC for the manual promotion, with rule 25's lockout. */
  checkPin(membershipId: string, pin: string): Promise<'ok' | 'invalid' | 'disabled'> {
    return this.run(async () => {
      const record = this.registered();
      if (!record) return 'invalid';
      const outcome = await checkPinLocally(record, membershipId, pin, this.deps.verifyPin);
      await this.save(outcome.record);
      this.deps.onChange();
      if (outcome.ok) return 'ok';
      return outcome.code === 'PIN_DISABLED' ? 'disabled' : 'invalid';
    });
  }

  /** Rule 44: a 5-minute device token for the device key's signature of a server nonce. */
  private async token(registration: Registration): Promise<string> {
    if (this.deviceToken && this.deviceToken.dueAt > this.deps.elapsed()) {
      return this.deviceToken.token;
    }
    const requestedAt = this.deps.elapsed();
    const { tenantId, deviceId } = registration;
    const { nonce } = await this.deps.client.challenge(tenantId, deviceId);
    const signed = await this.deps.client.token({
      tenantId,
      deviceId,
      nonce,
      signature: this.deps.sign(registration.privateKey, deviceTokenMessage(nonce, deviceId)),
      appVersion: this.deps.appVersion,
    });
    this.deviceToken = {
      token: signed.deviceToken,
      dueAt: requestedAt + deviceTokenTtlSeconds * 1000 - TOKEN_MARGIN_MS,
    };
    return signed.deviceToken;
  }

  /**
   * Rules 24 and 25: online when the API answers, so the server checks the device, the member and
   * the PIN; offline otherwise, against the verifier in the member list. A PIN disabled on this PC
   * is refused before either.
   */
  signIn(input: SignInInput): Promise<BridgeResult> {
    return this.run(async () => {
      const record = this.registered();
      if (!record) return { ok: false, code: 'DEVICE_UNKNOWN' };
      const member = record.memberList.members.find((m) => m.membershipId === input.membershipId);
      if (member && pinDisabledHere(record, member)) return { ok: false, code: 'PIN_DISABLED' };
      const now = this.deps.now();
      try {
        const tokens = await this.withToken(record.registration, (token) =>
          this.deps.client.openSession(token, input),
        );
        this.online = true;
        await this.save(recordSession(seeTime(record, now), input.membershipId, now));
        this.session = this.onlineSession(input.membershipId, tokens);
        return { ok: true };
      } catch (error) {
        if (isUnreachable(error)) {
          this.online = false;
          return this.signInHere(record, input, now);
        }
        this.online = true;
        if (codeOf(error) === 'DEVICE_REVOKED') {
          await this.wipe(record);
          return { ok: false, code: 'DEVICE_REVOKED' };
        }
        if (codeOf(error) === 'INVALID_PIN') {
          const counted = countFailure(record, input.membershipId);
          await this.save(counted);
          const disabled = localMember(counted, input.membershipId).disabled;
          return { ok: false, code: disabled ? 'PIN_DISABLED' : 'INVALID_PIN' };
        }
        return { ok: false, code: codeOf(error) };
      } finally {
        this.deps.onChange();
      }
    });
  }

  /**
   * Rule 22: an owner or manager who forgot their PIN signs in by password with this PC's device
   * token (a member of this PC skips the OTP), then opens their session by that ticket. Online
   * only; the server refuses anyone but an owner or manager of this PC.
   */
  signInByPassword(input: PasswordSignInInput): Promise<BridgeResult> {
    return this.run(async () => {
      const record = this.registered();
      if (!record) return { ok: false, code: 'DEVICE_UNKNOWN' };
      const member = record.memberList.members.find((m) => m.membershipId === input.membershipId);
      if (!member) return { ok: false, code: 'MEMBERSHIP_INACTIVE' };
      try {
        const tokens = await this.withToken(record.registration, async (token) => {
          const result = await this.deps.client.signIn(token, {
            phone: input.phone,
            password: input.password,
            intent: 'register_device',
            proofOfWork: input.proofOfWork,
          });
          // An OTP is asked only of someone who is not a member of this PC.
          if (result.step !== 'done') throw new DeviceApiError('FORBIDDEN');
          return this.deps.client.openSession(token, {
            membershipId: input.membershipId,
            ticket: result.ticket,
          });
        });
        this.online = true;
        const now = this.deps.now();
        await this.save(recordSession(seeTime(record, now), input.membershipId, now));
        this.session = {
          ...this.onlineSession(input.membershipId, tokens),
          replacing: { pinVerifier: member.pinVerifier },
        };
        return { ok: true };
      } catch (error) {
        this.online = !isUnreachable(error);
        if (codeOf(error) === 'DEVICE_REVOKED') {
          await this.wipe(record);
          return { ok: false, code: 'DEVICE_REVOKED' };
        }
        return { ok: false, code: codeOf(error) };
      } finally {
        this.deps.onChange();
      }
    });
  }

  private async signInHere(record: Registered, input: SignInInput, now: Date) {
    const outcome = await signInOffline(
      record,
      input.membershipId,
      input.pin,
      now,
      this.deps.verifyPin,
    );
    await this.save(outcome.record);
    if (outcome.ok)
      this.session = { membershipId: input.membershipId, tokens: null, accessDueAt: 0 };
    return this.result(outcome);
  }

  private result(outcome: LocalOutcome): BridgeResult {
    return outcome.ok ? { ok: true } : { ok: false, code: outcome.code };
  }

  /**
   * Rule 32: locking ends the session at once, outside the queue, so nothing waiting on a slow
   * connection (a member-list refresh, a token refresh) keeps it open; ending it on the server
   * follows in turn, when the API answers.
   */
  lock(reason: LockReason): Promise<void> {
    const ended = this.session;
    this.session = null;
    this.deps.onChange();
    return this.run(async () => {
      if (!ended?.tokens) return;
      await this.deps.client.endSession(ended.tokens.accessToken, reason).catch(() => undefined);
    });
  }

  /** The access token of an online session, refreshed (rotated) a minute before it expires. */
  accessToken(): Promise<string | null> {
    return this.run(async () => {
      const record = this.registered();
      const session = this.session;
      const current = session?.tokens;
      if (!(record && session && current)) return null;
      if (session.accessDueAt > this.deps.elapsed()) return current.accessToken;
      try {
        const tokens = await this.withToken(record.registration, (token) =>
          this.deps.client.refreshSession(token, current.refreshToken),
        );
        this.online = true;
        if (this.session !== session) {
          // Locked while the refresh ran (rule 32): the rotated session ends too.
          await this.deps.client.endSession(tokens.accessToken, 'locked').catch(() => undefined);
          return null;
        }
        // A session opened to replace a forgotten PIN still waits for it (rule 22).
        this.session = { ...session, ...this.onlineSession(session.membershipId, tokens) };
        return tokens.accessToken;
      } catch (error) {
        if (isUnreachable(error)) {
          this.online = false;
          return null;
        }
        // The session ended on the server (rule 44, a reuse, a deactivation): the PC locks.
        if (this.session !== session) return null;
        this.session = null;
        this.deps.onChange();
        if (codeOf(error) === 'DEVICE_REVOKED') await this.wipe(record);
        return null;
      }
    });
  }

  /**
   * Rule 28: the member list every 60 seconds while online and on reconnect, confirmed so the
   * window counts from the server's time. A member gone from the list loses their session on the
   * first connection (rule 33). A revoked PC wipes (rule 19).
   */
  refresh(): Promise<void> {
    return this.run(async () => {
      const record = this.record;
      if (record?.state === 'wiping') return this.finishWipe(record);
      if (record?.state !== 'registered') return;
      try {
        const list = await this.withToken(record.registration, async (token) => {
          const result = await this.deps.client.members(token, record.memberList.version);
          const current =
            result.status === 'current'
              ? result.list
              : { ...record.memberList, issuedAt: result.issuedAt };
          await this.deps.client.acknowledge(token, current.version);
          return current;
        });
        this.online = true;
        let next = this.withList(record.registration, list);
        // Rule 22: a PIN set anew (reset by a manager, or replaced by password) lifts the old
        // one's lockout on this PC.
        for (const listed of list.members) {
          const before = record.memberList.members.find(
            (m) => m.membershipId === listed.membershipId,
          );
          if (before && before.pinVerifier !== listed.pinVerifier) {
            next = clearLocalLockout(next, listed.membershipId);
          }
        }
        const member = list.members.find((m) => m.membershipId === this.session?.membershipId);
        if (this.session && !member) this.session = null;
        // The replaced PIN arrived: the session goes on as any other.
        if (this.session?.replacing && member?.pinVerifier !== this.session.replacing.pinVerifier) {
          const { replacing: _, ...session } = this.session;
          this.session = session;
        }
        await this.save(next, { clockFromServer: true });
      } catch (error) {
        if (isUnreachable(error)) {
          this.online = false;
          this.observe(this.deps.now());
        } else if (codeOf(error) === 'DEVICE_REVOKED') await this.wipe(record);
      } finally {
        this.deps.onChange();
      }
    });
  }

  /**
   * Rule 19: the session and the sealed member list go at once; the pending commands reach the
   * quarantine, then the local database is deleted (spec S04 rule 40); the key stays only until
   * the server has the wipe confirmation, then only the notice is kept.
   */
  private async wipe(record: Registered): Promise<void> {
    this.session = null;
    const wiping: Wiping = {
      state: 'wiping',
      registration: record.registration,
      tenantName: record.memberList.tenant.nameAr,
      quarantined: false,
    };
    await this.save(wiping);
    await this.finishWipe(wiping);
  }

  /** Spec S04 rule 40: the upload is tried again at every refresh until it succeeds. */
  private async finishWipe(record: Wiping): Promise<void> {
    let current = record;
    if (!current.quarantined) {
      const { deviceId, databaseKey } = current.registration;
      try {
        const data =
          this.data ?? (databaseKey ? await this.deps.openData(deviceId, databaseKey) : null);
        this.data = data;
        if (data) {
          await this.deps.quarantine(current.registration, data);
          // A delete cut short (a file held open) leaves a closed database: the next try opens
          // it again, uploads what is left, and deletes it.
          this.data = null;
          await data.destroy();
        }
      } catch {
        return;
      }
      this.data = null;
      this.persisted = null;
      current = { ...current, quarantined: true };
      await this.save(current);
    }
    await this.confirmWipe(current);
  }

  private async confirmWipe(record: Wiping): Promise<void> {
    try {
      await this.withToken(record.registration, (token) => this.deps.client.wiped(token));
    } catch (error) {
      // Already wiped on the server: it refuses the token. Anything else is tried again later.
      if (codeOf(error) !== 'DEVICE_REVOKED') return;
    }
    this.deviceToken = null;
    await this.save({ state: 'wiped', tenantName: record.tenantName });
  }

  /** Rule 27: the acting member is the one whose session is open on this PC. */
  approve(input: ApproveInput): Promise<BridgeResult> {
    return this.local((record) =>
      this.session?.membershipId === input.actingMembershipId
        ? approveLocally(record, input, input.pin, this.deps.verifyPin)
        : Promise.resolve({ record, ok: false, code: 'FORBIDDEN' }),
    );
  }

  reenablePin(input: ReenableInput): Promise<BridgeResult> {
    return this.local((record) => reenableLocally(record, input, input.pin, this.deps.verifyPin));
  }

  private local(check: (record: Registered) => Promise<LocalOutcome>): Promise<BridgeResult> {
    return this.run(async () => {
      const record = this.registered();
      if (!record) return { ok: false, code: 'DEVICE_UNKNOWN' };
      const outcome = await check(record);
      await this.save(outcome.record);
      this.deps.onChange();
      return this.result(outcome);
    });
  }

  dismissWipe(): Promise<void> {
    return this.run(async () => {
      if (this.record?.state !== 'wiped') return;
      this.deps.store.remove();
      this.record = null;
      this.deps.onChange();
    });
  }
}
