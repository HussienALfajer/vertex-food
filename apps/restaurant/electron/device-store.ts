import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import {
  idSchema,
  instantSchema,
  type MemberList,
  memberListSchema,
  publicKeySchema,
} from '@vertex-food/contracts';
import { z } from 'zod';

/** What `safeStorage` offers: on Windows, DPAPI under the signed-in Windows account. */
export type Sealer = {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
};

/** This PC's local record of one member of its list (rules 25, 30). */
const localMemberSchema = z.object({
  /** Wrong PINs in a row on this PC; five disable the PIN here (rule 25). */
  failures: z.int().min(0),
  disabled: z.boolean(),
  /** The first PIN session this member opened on this PC, for the post-window rule (rule 30). */
  firstSessionAt: instantSchema.nullable(),
});

export type LocalMember = z.infer<typeof localMemberSchema>;

const registrationSchema = z.object({
  tenantId: idSchema,
  branchId: idSchema,
  deviceId: idSchema,
  privateKey: z.string().min(1),
  publicKey: publicKeySchema,
  /**
   * The local database's key: 256 random bits, hex (spec S04 "On the PC"). A PC registered before
   * S04 gets one at its first start with S04, before its member list moves into the database.
   */
  databaseKey: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});

export type Registration = z.infer<typeof registrationSchema>;

/**
 * Everything S02 keeps on a PC (rules 16, 28–31) but the members, sealed in one file. A revoked PC
 * drops the member list at once and keeps its keys until its pending work reached the quarantine
 * and the server has its wipe confirmation (`wiping`, spec S04 rule 40), then keeps only the
 * notice it shows (`wiped`). The members, with their PIN verifiers and this PC's own record of
 * them, live in the local database (`local_members`, S02 rule 29); the file holds them only on a PC
 * registered before S04 until they moved, or while the local database cannot be written.
 */
export const deviceRecordSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('registered'),
    registration: registrationSchema,
    memberList: memberListSchema.extend({ members: memberListSchema.shape.members.optional() }),
    /** The server's time of the last member list this PC confirmed (rule 30). */
    membersSyncedAt: instantSchema,
    /** The highest time this PC has seen, from the server and its own clock (rule 31). */
    highestSeenAt: instantSchema,
    local: z.record(z.string(), localMemberSchema).optional(),
    /** Server time minus this PC's time, from the last heartbeat (spec S04 rule 14). */
    clockOffsetMs: z.int().nullable().optional(),
  }),
  z.object({
    state: z.literal('wiping'),
    registration: registrationSchema,
    tenantName: z.string(),
    /** Its pending commands reached the quarantine and the local database is gone (rule 40). */
    quarantined: z.boolean().optional(),
  }),
  z.object({ state: z.literal('wiped'), tenantName: z.string() }),
]);

export type StoredRecord = z.infer<typeof deviceRecordSchema>;

/** The record in memory: the sealed file's, with the members from the local database. */
export type DeviceRecord =
  | {
      state: 'registered';
      registration: Registration;
      memberList: MemberList;
      membersSyncedAt: string;
      highestSeenAt: string;
      local: Record<string, LocalMember>;
      clockOffsetMs?: number | null | undefined;
    }
  | Exclude<StoredRecord, { state: 'registered' }>;

/**
 * A record in a file sealed by `safeStorage` (the device record, the PC certificate). Nothing is
 * written in clear: without encryption the PC cannot be registered. Writes replace the file whole (a temporary file, then a
 * rename), so a power cut leaves the old record or the new one.
 */
export class SealedFile<T> {
  constructor(
    private readonly path: string,
    private readonly sealer: Sealer,
    private readonly schema: z.ZodType<T>,
  ) {}

  read(): T | null {
    if (!existsSync(this.path)) return null;
    try {
      const text = this.sealer.decryptString(readFileSync(this.path));
      const parsed = this.schema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : null;
    } catch {
      // Sealed under another Windows account, or damaged: the PC is registered again.
      return null;
    }
  }

  /** Whether a record can be sealed here (Windows: always, through DPAPI). */
  canWrite(): boolean {
    return this.sealer.isEncryptionAvailable();
  }

  write(record: T): void {
    if (!this.sealer.isEncryptionAvailable()) {
      throw new Error('Encryption is not available on this PC');
    }
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, this.sealer.encryptString(JSON.stringify(record)));
    renameSync(temporary, this.path);
  }

  remove(): void {
    rmSync(this.path, { force: true });
  }
}

/** The device record (S02) in its sealed file. */
export class DeviceStore extends SealedFile<StoredRecord> {
  constructor(path: string, sealer: Sealer) {
    super(path, sealer, deviceRecordSchema);
  }
}
