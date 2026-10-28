import { createHash, generateKeyPairSync, type KeyObject, randomInt, sign } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  type AddStaffMember,
  deviceTokenMessage,
  type RegisteredDevice,
  type SessionTokens,
  type StaffMember,
} from '@vertex-food/contracts';
import { accounts, type Database } from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { vi } from 'vitest';
import type { SystemActor } from '../src/core/access/actor.js';
import { type FakeOtpSender, OTP_SENDER } from '../src/modules/platform/identity/index.js';
import { TenancyService } from '../src/modules/platform/tenancy/index.js';

// Real sessions over HTTP for the integration tests (spec S02): a tenant with its owner, the
// owner's first sign-in with the fake OTP sender, a registered PC, PINs, members added through the
// staff routes. Copied from Vertex Shifa's `test/staff.ts` and adapted.

export const OPERATOR: SystemActor = { kind: 'system', name: 'test operator' };
export const PASSWORD = 'cedar-lamp-river-42';
export const ORIGIN = 'app://restaurant';

let phoneCount = 0;
/**
 * A synthetic Syrian mobile number, unique in the run. Its last six digits start with 1, so they
 * are never one of the PINs of `pinFor` (48…), which the API refuses as the phone's tail.
 */
export function newPhone(): string {
  phoneCount += 1;
  const clock = String(Date.now() % 100_000).padStart(5, '0');
  const count = String(phoneCount % 100).padStart(2, '0');
  return `+9639${clock.slice(0, 2)}1${clock.slice(2)}${count}`;
}

/** A six-digit PIN that is not trivial and not the phone's tail. */
export function pinFor(seed: number): string {
  return String(482_915 + seed * 7).padStart(6, '0');
}

function leadingZeroBits(digest: Buffer): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

/** Requests to `app` from a random client address. */
export function client(app: INestApplication) {
  const http = request(app.getHttpServer());
  const address = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  const from = (test: request.Test) => test.set('x-forwarded-for', address);
  return {
    get: (path: string) => from(http.get(path)),
    post: (path: string) => from(http.post(path)),
    put: (path: string) => from(http.put(path)),
    patch: (path: string) => from(http.patch(path)),
    delete: (path: string) => from(http.delete(path)),
  };
}

/** A solved proof of work from the API (the tests run at difficulty 4). */
export async function proofOfWork(app: INestApplication) {
  const { body } = await client(app).post('/api/auth/pow').expect(200);
  for (let nonce = 0; ; nonce += 1) {
    const digest = createHash('sha256').update(`${body.challenge}:${nonce}`).digest();
    if (leadingZeroBits(digest) >= body.difficulty) {
      return { challenge: body.challenge as string, nonce: String(nonce) };
    }
  }
}

/** An installation's Ed25519 key pair: the public key as base64 of the raw 32 bytes. */
export function newDeviceKeys(): { publicKey: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return { publicKey: Buffer.from(jwk.x, 'base64url').toString('base64'), privateKey };
}

export class TestApi {
  readonly otps: FakeOtpSender;
  private slugCount = 0;

  constructor(
    readonly app: INestApplication,
    readonly db: Database,
  ) {
    this.otps = app.get(OTP_SENDER) as FakeOtpSender;
  }

  /**
   * Requests from a random client address (the API trusts the loopback proxy's
   * `X-Forwarded-For`), so the per-address limits of one test never spill into another.
   */
  http() {
    return client(this.app);
  }

  /** The last code sent to the account; the messaging tests read it from the queued message. */
  async lastCode(accountId: string): Promise<string | undefined> {
    return this.otps.lastCode(accountId);
  }

  async accountId(phone: string): Promise<string> {
    const [row] = await this.db.select().from(accounts).where(eq(accounts.phone, phone));
    if (!row) throw new Error('No account for this phone');
    return row.id;
  }

  /** A tenant made by Vertex staff with its first owner and `branchCodes`. */
  async newTenant(branchCodes = ['main']) {
    this.slugCount += 1;
    const ownerPhone = newPhone();
    const detail = await this.app.get(TenancyService).createTenant(OPERATOR, {
      nameAr: 'مطعم تجريبي',
      slug: `t-${Date.now().toString(36)}-${this.slugCount}-${randomInt(46_656).toString(36)}`,
      defaultCurrency: 'USD',
      branches: branchCodes.map((code, index) => ({ nameAr: `فرع ${index + 1}`, code })),
      owner: { phone: ownerPhone, displayName: 'مالك تجريبي' },
    });
    return {
      tenantId: detail.tenant.id,
      ownerPhone,
      branchIds: detail.branches.map((branch) => branch.id),
    };
  }

  /** Rule 13: the first sign-in with an OTP and a new password; answers a `signed_in` ticket. */
  async firstSignIn(phone: string, intent: 'register_device' | 'personal' = 'register_device') {
    // Solved first: supertest closes the shared server when a request ends, so requests never nest.
    const solved = await proofOfWork(this.app);
    const requested = await this.http()
      .post('/api/auth/otp/request')
      .send({ phone, purpose: 'first_sign_in', intent, proofOfWork: solved })
      .expect(200);
    const code = await this.lastCode(await this.accountId(phone));
    const verified = await this.http()
      .post('/api/auth/otp/verify')
      .send({ challengeId: requested.body.challengeId, code, intent })
      .expect(200);
    const set = await this.http()
      .post('/api/auth/password')
      .set('x-sign-in-ticket', verified.body.ticket)
      .send({ name: 'اسم تجريبي', password: PASSWORD })
      .expect(200);
    return { ticket: set.body.ticket as string, cookies: verified.headers['set-cookie'] };
  }

  /**
   * Rules 11, 12: a password sign-in on a new PC, through its OTP; answers the ticket. The clock
   * moves past the minute between two codes to one phone (the file runs with a fake `Date`).
   */
  async signInWithOtp(phone: string, intent: 'register_device' | 'personal' = 'register_device') {
    vi.setSystemTime(Date.now() + 61_000);
    const solved = await proofOfWork(this.app);
    const started = await this.http()
      .post('/api/auth/sign-in')
      .send({ phone, password: PASSWORD, intent, proofOfWork: solved })
      .expect(200);
    if (started.body.step === 'done') return { ticket: started.body.ticket as string, cookies: [] };
    const code = await this.lastCode(await this.accountId(phone));
    const verified = await this.http()
      .post('/api/auth/otp/verify')
      .send({ challengeId: started.body.challengeId, code, intent })
      .expect(200);
    return { ticket: verified.body.ticket as string, cookies: verified.headers['set-cookie'] };
  }

  /** Rule 16: registers a PC to `branchId` with a `register_device` ticket. */
  async registerDevice(ticket: string, tenantId: string, branchId: string) {
    const keys = newDeviceKeys();
    const response = await this.http()
      .post('/api/devices')
      .set('x-sign-in-ticket', ticket)
      .send({
        tenantId,
        branchId,
        name: 'الكاشير 1',
        publicKey: keys.publicKey,
        os: 'Windows 11',
        appVersion: '0.1.0',
      })
      .expect(201);
    const registered = response.body as RegisteredDevice;
    return new TestDevice(this, tenantId, registered.device.id, keys.privateKey, registered);
  }

  /** A tenant with its owner signed in on a registered PC of its first branch, with a PIN. */
  async ownerOnDevice(branchCodes = ['main']) {
    const tenant = await this.newTenant(branchCodes);
    const { ticket } = await this.firstSignIn(tenant.ownerPhone);
    const device = await this.registerDevice(
      ticket,
      tenant.tenantId,
      tenant.branchIds[0] as string,
    );
    const owner = device.registration.session;
    await device
      .as(owner)
      .put('/api/me/pin')
      .send({ newPin: pinFor(0) })
      .expect(204);
    const me = await device.as(owner).get('/api/me').expect(200);
    return { ...tenant, device, owner, ownerMembershipId: me.body.membershipId as string };
  }
}

/** A registered PC of the tests, with its key, its device token and its sessions. */
export class TestDevice {
  constructor(
    readonly api: TestApi,
    readonly tenantId: string,
    readonly deviceId: string,
    readonly privateKey: KeyObject,
    readonly registration: RegisteredDevice,
  ) {}

  async token(): Promise<string> {
    const challenge = await this.api
      .http()
      .post('/api/devices/token/challenge')
      .send({ tenantId: this.tenantId, deviceId: this.deviceId })
      .expect(200);
    const nonce = challenge.body.nonce as string;
    const signature = sign(
      null,
      Buffer.from(deviceTokenMessage(nonce, this.deviceId)),
      this.privateKey,
    ).toString('base64');
    const response = await this.api.http().post('/api/devices/token').send({
      tenantId: this.tenantId,
      deviceId: this.deviceId,
      nonce,
      signature,
      appVersion: '0.1.0',
    });
    if (response.status !== 200) throw new Error(`No device token: ${response.body.code}`);
    return response.body.deviceToken as string;
  }

  /** Requests with the device token. */
  async device() {
    const token = await this.token();
    const http = this.api.http();
    const withToken = (test: request.Test) => test.set('x-device-token', token);
    return {
      get: (path: string) => withToken(http.get(path)),
      post: (path: string) => withToken(http.post(path)),
      put: (path: string) => withToken(http.put(path)),
    };
  }

  /** Requests as a staff session of this PC. */
  as(session: SessionTokens) {
    const http = this.api.http();
    const withSession = (test: request.Test) =>
      test.set('authorization', `Bearer ${session.accessToken}`).set('origin', ORIGIN);
    return {
      get: (path: string) => withSession(http.get(path)),
      post: (path: string) => withSession(http.post(path)),
      put: (path: string) => withSession(http.put(path)),
      patch: (path: string) => withSession(http.patch(path)),
      delete: (path: string) => withSession(http.delete(path)),
    };
  }

  /** Rule 24: a PIN session of `membershipId` on this PC. */
  async signIn(membershipId: string, pin: string): Promise<SessionTokens> {
    const device = await this.device();
    const response = await device.post('/api/sessions').send({ membershipId, pin });
    if (response.status !== 201) throw new Error(`No session: ${response.body.code}`);
    return response.body as SessionTokens;
  }

  /** Adds a member as `session` (password entered within 5 minutes) and sets their PIN here. */
  async addMember(
    session: SessionTokens,
    member: Omit<AddStaffMember, 'phone' | 'grantedPermissions' | 'revokedPermissions'> &
      Partial<AddStaffMember>,
    pin?: string,
  ): Promise<StaffMember & { phone: string }> {
    const phone = member.phone ?? newPhone();
    const added = await this.as(session)
      .post('/api/staff')
      .send({ grantedPermissions: [], revokedPermissions: [], ...member, phone })
      .expect(201);
    if (pin) {
      await this.as(session).put(`/api/staff/${added.body.id}/pin`).send({ pin }).expect(204);
    }
    return { ...(added.body as StaffMember), phone };
  }
}
