import {
  type SessionTokens,
  type StaffSessionEndReason,
  staffSessionPolicy,
} from '@vertex-food/contracts';
import { devices, staffSessions, type Transaction } from '@vertex-food/db';
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { type KeyedHash, safeEqual } from './crypto.js';
import { randomToken } from './secrets.js';
import type { TokenSigner } from './tokens.js';

const HOUR_MS = 3_600_000;

/** What a session token's mac and stored hash are made for, apart per kind of token. */
const PURPOSES = {
  device: { mac: 'refresh-token-mac', stored: 'refresh-token' },
  personal: { mac: 'personal-session-mac', stored: 'personal-session' },
} as const;

type TokenKind = keyof typeof PURPOSES;

/**
 * Opens and refreshes staff sessions (spec S02 rules 24, 35, 44). A PIN session on a registered PC
 * gets a 15-minute access token and an opaque refresh token for at most 12 hours, rotated on each
 * refresh; a personal-device session gets an opaque cookie token. Opaque tokens carry their tenant
 * and session id, signed by a keyed hash, and are stored only as a keyed hash. Copied from Vertex
 * Shifa and adapted.
 */
export class SessionIssuer {
  constructor(
    private readonly tokens: TokenSigner,
    private readonly hashes: KeyedHash,
  ) {}

  /** A PIN session on a registered PC; `passwordVerifiedAt` when it opened with a password. */
  async openDevice(
    tx: Transaction,
    session: { tenantId: string; membershipId: string; deviceId: string },
    now: Date,
    passwordVerifiedAt: Date | null = null,
  ): Promise<SessionTokens> {
    const id = uuidv7();
    const refreshToken = this.token('device', session.tenantId, id);
    const expiresAt = new Date(now.getTime() + staffSessionPolicy.maxHours * HOUR_MS);
    await tx.insert(staffSessions).values({
      id,
      ...session,
      kind: 'device',
      refreshTokenHash: this.hashes.hash(PURPOSES.device.stored, refreshToken),
      expiresAt,
      lastRefreshedAt: now,
      passwordVerifiedAt,
    });
    return this.tokensOf({ ...session, sessionId: id, refreshToken, expiresAt }, now);
  }

  /** New tokens for an open device session, its refresh token replaced. */
  async refreshDevice(
    tx: Transaction,
    session: {
      tenantId: string;
      membershipId: string;
      deviceId: string;
      sessionId: string;
      expiresAt: Date;
    },
    now: Date,
  ): Promise<SessionTokens> {
    const refreshToken = this.token('device', session.tenantId, session.sessionId);
    await tx
      .update(staffSessions)
      .set({
        refreshTokenHash: this.hashes.hash(PURPOSES.device.stored, refreshToken),
        lastRefreshedAt: now,
        updatedAt: now,
      })
      .where(eq(staffSessions.id, session.sessionId));
    return this.tokensOf({ ...session, refreshToken }, now);
  }

  /**
   * A personal-device session (rule 35): the cookie's token, its absolute end. The sign-in counts
   * as the first password entry (rule 26).
   */
  async openPersonal(
    tx: Transaction,
    session: { tenantId: string; membershipId: string; personalDeviceId: string },
    now: Date,
  ): Promise<{ sessionId: string; token: string; expiresAt: Date }> {
    const id = uuidv7();
    const token = this.token('personal', session.tenantId, id);
    const expiresAt = new Date(now.getTime() + staffSessionPolicy.maxHours * HOUR_MS);
    await tx.insert(staffSessions).values({
      id,
      ...session,
      kind: 'personal',
      refreshTokenHash: this.hashes.hash(PURPOSES.personal.stored, token),
      expiresAt,
      lastRefreshedAt: now,
      passwordVerifiedAt: now,
    });
    return { sessionId: id, token, expiresAt };
  }

  /** The tenant and session an opaque token names, if its signature holds. */
  parse(kind: TokenKind, token: string): { tenantId: string; sessionId: string } | undefined {
    const [version, tenantId, sessionId, secret, mac, ...rest] = token.split('.');
    if (version !== 'v1' || !tenantId || !sessionId || !secret || !mac || rest.length > 0) {
      return undefined;
    }
    const body = `${tenantId}.${sessionId}.${secret}`;
    return safeEqual(this.hashes.hash(PURPOSES[kind].mac, body), mac)
      ? { tenantId, sessionId }
      : undefined;
  }

  matchesStored(kind: TokenKind, token: string, storedHash: string): boolean {
    return this.hashes.matches(PURPOSES[kind].stored, token, storedHash);
  }

  private token(kind: TokenKind, tenantId: string, sessionId: string): string {
    const body = `${tenantId}.${sessionId}.${randomToken()}`;
    return `v1.${body}.${this.hashes.hash(PURPOSES[kind].mac, body)}`;
  }

  private tokensOf(
    session: {
      tenantId: string;
      membershipId: string;
      deviceId: string;
      sessionId: string;
      refreshToken: string;
      expiresAt: Date;
    },
    now: Date,
  ): SessionTokens {
    // The access token never outlives its session.
    const ttl = Math.min(
      staffSessionPolicy.accessTokenMinutes * 60,
      Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000),
    );
    const access = this.tokens.sign(
      'access',
      {
        tid: session.tenantId,
        sid: session.sessionId,
        mid: session.membershipId,
        did: session.deviceId,
      },
      ttl,
      now,
    );
    return {
      sessionId: session.sessionId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
    };
  }
}

/** Ends the open sessions of the transaction's tenant that `where` selects. */
export async function endSessions(
  tx: Transaction,
  where: SQL | undefined,
  reason: StaffSessionEndReason,
  now: Date,
): Promise<void> {
  await tx
    .update(staffSessions)
    .set({ endedAt: now, endReason: reason, updatedAt: now })
    .where(and(isNull(staffSessions.endedAt), where));
}

/** The open sessions of a member on PCs of `branchIds`, which left their scope (rule 8). */
export function onBranches(
  tx: Transaction,
  membershipId: string,
  branchIds: string[],
): SQL | undefined {
  return and(
    eq(staffSessions.membershipId, membershipId),
    inArray(
      staffSessions.deviceId,
      tx.select({ id: devices.id }).from(devices).where(inArray(devices.branchId, branchIds)),
    ),
  );
}
