import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { idSchema, instantSchema, memberListSchema, publicKeySchema } from '@vertex-food/contracts';
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
});

export type Registration = z.infer<typeof registrationSchema>;

/**
 * Everything S02 keeps on a PC (rules 16, 28–31), sealed in one file. A revoked PC drops the member
 * list at once and keeps its key only until the server has its wipe confirmation (`wiping`), then
 * keeps only the notice it shows (`wiped`). S04 moves the member list into the local database.
 */
export const deviceRecordSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('registered'),
    registration: registrationSchema,
    memberList: memberListSchema,
    /** The server's time of the last member list this PC confirmed (rule 30). */
    membersSyncedAt: instantSchema,
    /** The highest time this PC has seen, from the server and its own clock (rule 31). */
    highestSeenAt: instantSchema,
    local: z.record(z.string(), localMemberSchema),
  }),
  z.object({
    state: z.literal('wiping'),
    registration: registrationSchema,
    tenantName: z.string(),
  }),
  z.object({ state: z.literal('wiped'), tenantName: z.string() }),
]);

export type DeviceRecord = z.infer<typeof deviceRecordSchema>;

/**
 * The device record in a file sealed by `safeStorage`. Nothing is written in clear: without
 * encryption the PC cannot be registered. Writes replace the file whole (a temporary file, then a
 * rename), so a power cut leaves the old record or the new one.
 */
export class DeviceStore {
  constructor(
    private readonly path: string,
    private readonly sealer: Sealer,
  ) {}

  read(): DeviceRecord | null {
    if (!existsSync(this.path)) return null;
    try {
      const text = this.sealer.decryptString(readFileSync(this.path));
      const parsed = deviceRecordSchema.safeParse(JSON.parse(text));
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

  write(record: DeviceRecord): void {
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
