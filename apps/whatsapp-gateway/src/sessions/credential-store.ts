import { type Database, type MessagingCrypto, whatsappSessionCredentials } from '@vertex-food/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { CredentialStore } from '../transport/whatsapp-transport.js';

/** A write refused because this connection no longer owns the session's link. */
export class CredentialsFencedError extends Error {
  override name = 'CredentialsFencedError';
}

/**
 * A session's Baileys credentials and key store in `whatsapp_session_credentials` (spec S03
 * rule 3). The store's keys name WhatsApp addresses, so a key is stored only as a keyed hash bound
 * to the session, and every value is sealed with context `whatsapp-credentials:<session id>`,
 * bound to its key's hash too, so a value copied to another key or session never opens.
 *
 * Writes are fenced: they apply only while this gateway instance holds the session's lease, the
 * session is not archived and its link is still the one this connection started with (its
 * `link_deadline_at`: a re-link sets a new one). So a connection an admin re-linked or unlinked
 * never writes back the credentials the API deleted. One `set` is one transaction.
 */
export class DatabaseCredentialStore implements CredentialStore {
  private readonly context: string;

  constructor(
    private readonly db: Database,
    private readonly crypto: MessagingCrypto,
    private readonly sessionId: string,
    private readonly holder: string,
    private readonly linkDeadlineAt: Date | null,
  ) {
    this.context = `whatsapp-credentials:${sessionId}`;
  }

  async get(keys: readonly string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    if (keys.length === 0) return found;
    const byHash = new Map(keys.map((key) => [this.keyHash(key), key]));
    const rows = await this.db
      .select({
        keyHash: whatsappSessionCredentials.keyHash,
        valueSealed: whatsappSessionCredentials.valueSealed,
      })
      .from(whatsappSessionCredentials)
      .where(
        and(
          eq(whatsappSessionCredentials.sessionId, this.sessionId),
          inArray(whatsappSessionCredentials.keyHash, [...byHash.keys()]),
        ),
      );
    for (const row of rows) {
      const key = byHash.get(row.keyHash);
      const value = key && this.crypto.box.open(this.valueContext(row.keyHash), row.valueSealed);
      if (key && value !== undefined) found.set(key, value);
    }
    return found;
  }

  async set(entries: Record<string, string | null>): Promise<void> {
    const writes = Object.entries(entries).map(([key, value]) => ({
      keyHash: this.keyHash(key),
      value,
    }));
    if (writes.length === 0) return;
    await this.db.transaction(async (tx) => {
      const owner = await tx.execute(sql`
        select 1 from whatsapp_sessions
        where id = ${this.sessionId}
          and lease_holder = ${this.holder}
          and archived_at is null
          -- To the millisecond: the epoch went through a JavaScript Date.
          and date_trunc('milliseconds', link_deadline_at)
            is not distinct from ${this.linkDeadlineAt?.toISOString() ?? null}::timestamptz
        for share
      `);
      if (owner.rows.length === 0) throw new CredentialsFencedError('The session link moved on');

      const removed = writes.filter((write) => write.value === null).map((write) => write.keyHash);
      if (removed.length > 0) {
        await tx
          .delete(whatsappSessionCredentials)
          .where(
            and(
              eq(whatsappSessionCredentials.sessionId, this.sessionId),
              inArray(whatsappSessionCredentials.keyHash, removed),
            ),
          );
      }
      const kept = writes.flatMap((write) =>
        write.value === null
          ? []
          : [
              {
                id: uuidv7(),
                sessionId: this.sessionId,
                keyHash: write.keyHash,
                valueSealed: this.crypto.box.seal(this.valueContext(write.keyHash), write.value),
              },
            ],
      );
      if (kept.length > 0) {
        await tx
          .insert(whatsappSessionCredentials)
          .values(kept)
          .onConflictDoUpdate({
            target: [whatsappSessionCredentials.sessionId, whatsappSessionCredentials.keyHash],
            set: { valueSealed: sql`excluded.value_sealed`, updatedAt: sql`now()` },
          });
      }
    });
  }

  private keyHash(key: string): string {
    return this.crypto.hash.hash(this.context, key);
  }

  private valueContext(keyHash: string): string {
    return `${this.context}:${keyHash}`;
  }
}
