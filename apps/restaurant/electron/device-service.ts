import { deviceTokenMessage, type MemberList, type SessionTokens } from '@vertex-food/contracts';
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

type Session = { membershipId: string; tokens: SessionTokens | null };

export type DeviceServiceDeps = {
  store: DeviceStore;
  client: DeviceApi;
  verifyPin: VerifyPin;
  generateKey: () => DeviceKey;
  sign: (privateKey: string, message: string) => string;
  now: () => Date;
  os: string;
  appVersion: string;
  /** The status may have changed: the renderer reads it again. */
  onChange: () => void;
};

/** A device token is fetched again this long before it expires. */
const TOKEN_MARGIN_MS = 30_000;

function codeOf(error: unknown): string {
  return error instanceof DeviceApiError ? error.code : 'INTERNAL_ERROR';
}

function later(a: string, b: Date): string {
  return Date.parse(a) > b.getTime() ? a : b.toISOString();
}

/**
 * The PC's identity in the main process (spec S02 rules 16–33): registration, device tokens, the
 * member list and its offline window, PIN sessions online and offline, approvals, the wipe. Every
 * operation runs one at a time, so two writes of the sealed record never interleave.
 */
export class DeviceService {
  private record: DeviceRecord | null;
  private session: Session | null = null;
  private deviceToken: { token: string; expiresAt: number } | null = null;
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
        pinDisabled: pinDisabledHere(record, member),
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
        const me = await this.deps.client.me(result.session.accessToken);
        const now = this.deps.now();
        const registration: Registration = {
          tenantId: input.tenantId,
          branchId: input.branchId,
          deviceId: result.device.id,
          privateKey: key.privateKey,
          publicKey: key.publicKey,
        };
        this.online = true;
        this.save(
          recordSession(this.withList(registration, result.members, now), me.membershipId, now),
        );
        this.session = { membershipId: me.membershipId, tokens: result.session };
        return { ok: true };
      } catch (error) {
        if (isUnreachable(error)) this.online = false;
        return { ok: false, code: codeOf(error) };
      } finally {
        this.deps.onChange();
      }
    });
  }

  private withList(registration: Registration, list: MemberList, now: Date): Registered {
    const previous = this.registered();
    return {
      state: 'registered',
      registration,
      memberList: list,
      membersSyncedAt: list.issuedAt,
      highestSeenAt: later(
        later(previous?.highestSeenAt ?? list.issuedAt, now),
        new Date(list.issuedAt),
      ),
      local: previous?.local ?? {},
    };
  }

  /** Rule 44: a 5-minute device token for the device key's signature of a server nonce. */
  private async token(registration: Registration): Promise<string> {
    const now = this.deps.now().getTime();
    if (this.deviceToken && this.deviceToken.expiresAt - TOKEN_MARGIN_MS > now) {
      return this.deviceToken.token;
    }
    const { tenantId, deviceId } = registration;
    const { nonce } = await this.deps.client.challenge(tenantId, deviceId);
    const signed = await this.deps.client.token({
      tenantId,
      deviceId,
      nonce,
      signature: this.deps.sign(registration.privateKey, deviceTokenMessage(nonce, deviceId)),
      appVersion: this.deps.appVersion,
    });
    this.deviceToken = { token: signed.deviceToken, expiresAt: Date.parse(signed.expiresAt) };
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
        const token = await this.token(record.registration);
        const tokens = await this.deps.client.openSession(token, input);
        this.online = true;
        this.save(recordSession(seeTime(record, now), input.membershipId, now));
        this.session = { membershipId: input.membershipId, tokens };
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
    if (outcome.ok) this.session = { membershipId: input.membershipId, tokens: null };
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
      if (!record || !session?.tokens) return null;
      const now = this.deps.now().getTime();
      if (Date.parse(session.tokens.accessTokenExpiresAt) - 60_000 > now) {
        return session.tokens.accessToken;
      }
      try {
        const token = await this.token(record.registration);
        const tokens = await this.deps.client.refreshSession(token, session.tokens.refreshToken);
        this.online = true;
        session.tokens = tokens;
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
        const token = await this.token(record.registration);
        const result = await this.deps.client.members(token, record.memberList.version);
        const now = this.deps.now();
        const list =
          result.status === 'current'
            ? result.list
            : { ...record.memberList, issuedAt: result.issuedAt };
        await this.deps.client.acknowledge(token, list.version);
        this.online = true;
        this.save(this.withList(record.registration, list, now));
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
      const token = await this.token(record.registration);
      await this.deps.client.wiped(token);
    } catch (error) {
      // Already wiped on the server: it refuses the token. Anything else is tried again later.
      if (codeOf(error) !== 'DEVICE_REVOKED') return;
    }
    this.deviceToken = null;
    this.save({ state: 'wiped', tenantName: record.tenantName });
  }

  approve(input: ApproveInput): Promise<BridgeResult> {
    return this.local((record) => approveLocally(record, input, input.pin, this.deps.verifyPin));
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
