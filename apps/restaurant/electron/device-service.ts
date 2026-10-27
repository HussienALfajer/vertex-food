import {
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
  ReenableInput,
  RegisterInput,
  SignInInput,
} from './bridge.js';
import { type DeviceApi, DeviceApiError, isUnreachable } from './device-client.js';
import type { DeviceKey } from './device-key.js';
import type { DeviceRecord, DeviceStore, Registration } from './device-store.js';
import {
  approveLocally,
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

type Registered = Extract<DeviceRecord, { state: 'registered' }>;

/**
 * A PIN session; an online one holds its tokens and when its access token is due, on the
 * monotonic clock (`elapsed`).
 */
type Session = {
  membershipId: string;
  tokens: SessionTokens | null;
  accessDueAt: number;
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
  private record: DeviceRecord | null;
  private session: Session | null = null;
  private deviceToken: { token: string; dueAt: number } | null = null;
  private online = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: DeviceServiceDeps) {
    this.record = deps.store.read();
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private save(record: DeviceRecord): void {
    this.deps.store.write(record);
    this.record = record;
  }

  private registered(): Registered | null {
    return this.record?.state === 'registered' ? this.record : null;
  }

  status(): DeviceStatus {
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
      window: windowOf(record, this.deps.now()),
      online: this.online,
      session: this.session
        ? { membershipId: this.session.membershipId, online: this.session.tokens !== null }
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
        };
        this.online = true;
        const registered = this.withList(registration, result.members);
        const membershipId = membershipOfAccessToken(result.session.accessToken);
        // Saved at once, with the key; the registering member's session follows from the token.
        this.save(membershipId ? recordSession(registered, membershipId, now) : registered);
        if (membershipId) this.session = this.onlineSession(membershipId, result.session);
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
        this.save(recordSession(seeTime(record, now), input.membershipId, now));
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
          this.save(counted);
          const disabled = localMember(counted, input.membershipId).disabled;
          return { ok: false, code: disabled ? 'PIN_DISABLED' : 'INVALID_PIN' };
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
    this.save(outcome.record);
    if (outcome.ok)
      this.session = { membershipId: input.membershipId, tokens: null, accessDueAt: 0 };
    return this.result(outcome);
  }

  private result(outcome: LocalOutcome): BridgeResult {
    return outcome.ok ? { ok: true } : { ok: false, code: outcome.code };
  }

  /** Rule 32: locking ends the session, online too when the API answers. */
  lock(reason: LockReason): Promise<void> {
    return this.run(async () => {
      const ended = this.session;
      this.session = null;
      this.deps.onChange();
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
        this.session = this.onlineSession(session.membershipId, tokens);
        return tokens.accessToken;
      } catch (error) {
        if (isUnreachable(error)) {
          this.online = false;
          return null;
        }
        // The session ended on the server (rule 44, a reuse, a deactivation): the PC locks.
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
      if (record?.state === 'wiping') return this.confirmWipe(record);
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
        this.save(this.withList(record.registration, list));
        const member = list.members.find((m) => m.membershipId === this.session?.membershipId);
        if (this.session && !member) this.session = null;
      } catch (error) {
        if (isUnreachable(error)) this.online = false;
        else if (codeOf(error) === 'DEVICE_REVOKED') await this.wipe(record);
      } finally {
        this.deps.onChange();
      }
    });
  }

  /**
   * Rule 19: the member list and the session go at once; the key stays only until the server has
   * the wipe confirmation, then only the notice is kept.
   */
  private async wipe(record: Registered): Promise<void> {
    this.session = null;
    const wiping: DeviceRecord = {
      state: 'wiping',
      registration: record.registration,
      tenantName: record.memberList.tenant.nameAr,
    };
    this.save(wiping);
    await this.confirmWipe(wiping);
  }

  private async confirmWipe(record: Extract<DeviceRecord, { state: 'wiping' }>): Promise<void> {
    try {
      await this.withToken(record.registration, (token) => this.deps.client.wiped(token));
    } catch (error) {
      // Already wiped on the server: it refuses the token. Anything else is tried again later.
      if (codeOf(error) !== 'DEVICE_REVOKED') return;
    }
    this.deviceToken = null;
    this.save({ state: 'wiped', tenantName: record.tenantName });
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
      this.save(outcome.record);
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
