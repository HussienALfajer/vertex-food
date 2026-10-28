import { type PersonalDevice, personalDeviceDays } from '@vertex-food/contracts';
import type { KeyedHash } from '@vertex-food/crypto';
import { type Database, personalDevices, type Transaction } from '@vertex-food/db';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { randomToken } from './secrets.js';

const DAY_MS = 86_400_000;
const PURPOSE = 'personal-device';

/** "Chrome · Android": the browser and system families of a user agent, nothing else. */
export function deviceLabel(userAgent: string | undefined): string {
  const agent = userAgent ?? '';
  const browser =
    [
      ['Edge', /Edg\//],
      ['Firefox', /Firefox\//],
      ['Chrome', /Chrome\//],
      ['Safari', /Safari\//],
      ['Vertex Food', /VertexFood/],
    ].find(([, pattern]) => (pattern as RegExp).test(agent))?.[0] ?? 'Browser';
  const system =
    [
      ['Android', /Android/],
      ['iOS', /iPhone|iPad/],
      ['Windows', /Windows/],
      ['macOS', /Mac OS X/],
      ['Linux', /Linux/],
    ].find(([, pattern]) => (pattern as RegExp).test(agent))?.[0] ?? 'Other';
  return `${browser} · ${system}`;
}

/**
 * Personal devices (spec S02 rules 12, 35): a browser or app where the account completed an OTP,
 * known by a random token kept in an `HttpOnly` cookie and stored as a keyed hash. Known for 90
 * days after the last use.
 */
export class PersonalDeviceStore {
  constructor(private readonly hashes: KeyedHash) {}

  async create(
    tx: Database | Transaction,
    accountId: string,
    userAgent: string | undefined,
    now: Date,
  ): Promise<{ id: string; token: string }> {
    const token = randomToken();
    const [row] = await tx
      .insert(personalDevices)
      .values({
        accountId,
        tokenHash: this.hashes.hash(PURPOSE, token),
        label: deviceLabel(userAgent),
        lastUsedAt: now,
        expiresAt: new Date(now.getTime() + personalDeviceDays * DAY_MS),
      })
      .returning({ id: personalDevices.id });
    if (!row) throw new Error('No personal device inserted');
    return { id: row.id, token };
  }

  /** The account's known device of this cookie, its use recorded; undefined otherwise. */
  async recognize(
    db: Database,
    accountId: string,
    token: string | undefined,
    now: Date,
  ): Promise<string | undefined> {
    if (!token) return undefined;
    const [row] = await db
      .update(personalDevices)
      .set({
        lastUsedAt: now,
        expiresAt: new Date(now.getTime() + personalDeviceDays * DAY_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(personalDevices.tokenHash, this.hashes.hash(PURPOSE, token)),
          eq(personalDevices.accountId, accountId),
          isNull(personalDevices.revokedAt),
          gt(personalDevices.expiresAt, now),
        ),
      )
      .returning({ id: personalDevices.id });
    return row?.id;
  }

  async list(db: Database, accountId: string, currentId: string | null): Promise<PersonalDevice[]> {
    const now = new Date();
    const rows = await db
      .select()
      .from(personalDevices)
      .where(
        and(
          eq(personalDevices.accountId, accountId),
          isNull(personalDevices.revokedAt),
          gt(personalDevices.expiresAt, now),
        ),
      )
      .orderBy(desc(personalDevices.lastUsedAt));
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      lastUsedAt: row.lastUsedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      current: row.id === currentId,
    }));
  }
}
