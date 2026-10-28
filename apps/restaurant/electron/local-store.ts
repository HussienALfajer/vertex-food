import { type DeviceMember, deviceMemberSchema } from '@vertex-food/contracts';
import { z } from 'zod';
import type { LocalMember } from './device-store.js';
import {
  destroyLocalDatabase,
  type LocalDatabaseState,
  type OpenedDatabase,
  openLocalDatabase,
} from './local-db.js';

/** The member list's members as the PC keeps them, with its own record of each (S02 rules 25, 30). */
export type StoredMembers = {
  /** The list version the members came with; null when the rows disagree (a cut write). */
  version: string | null;
  members: DeviceMember[];
  local: Record<string, LocalMember>;
};

/** What `DeviceService` needs from the local database (spec S04 "On the PC"). */
export interface LocalData {
  readonly state: LocalDatabaseState;
  loadMembers(): Promise<StoredMembers | null>;
  /** Replaces the members and their local records in one transaction. */
  saveMembers(members: StoredMembers & { version: string }): Promise<void>;
  /** Deletes the database (a revoked PC, rule 40). */
  destroy(): Promise<void>;
}

type MemberRow = {
  id: string;
  listed: number;
  list_version: string | null;
  name: string | null;
  roles: string | null;
  permissions: string | null;
  pin_verifier: string | null;
  pin_disabled: number | null;
  failures: number | null;
  disabled_here: number | null;
  first_session_at: string | null;
};

const stringList = z.array(z.string());

function parseList(value: string | null): string[] {
  try {
    return stringList.parse(JSON.parse(value ?? '[]'));
  } catch {
    return [];
  }
}

function memberOf(row: MemberRow): DeviceMember | null {
  const parsed = deviceMemberSchema.safeParse({
    membershipId: row.id,
    name: row.name,
    roles: parseList(row.roles),
    permissions: parseList(row.permissions),
    pinVerifier: row.pin_verifier,
    pinDisabled: row.pin_disabled === 1,
  });
  return parsed.success ? parsed.data : null;
}

/** The PC's opened local database: its member list, and the database the sync client uses. */
export class LocalStore implements LocalData {
  private constructor(
    private readonly directory: string,
    readonly opened: OpenedDatabase,
  ) {}

  static async open(directory: string, hexKey: string): Promise<LocalStore> {
    return new LocalStore(directory, await openLocalDatabase(directory, hexKey));
  }

  get state(): LocalDatabaseState {
    return this.opened.state;
  }

  async loadMembers(): Promise<StoredMembers | null> {
    const rows = await this.opened.reads.getAll<MemberRow>('SELECT * FROM local_members');
    if (rows.length === 0) return null;
    const listed = rows.filter((row) => row.listed === 1);
    const versions = new Set(listed.map((row) => row.list_version));
    const local: Record<string, LocalMember> = {};
    for (const row of rows) {
      local[row.id] = {
        failures: row.failures ?? 0,
        disabled: row.disabled_here === 1,
        firstSessionAt: row.first_session_at,
      };
    }
    return {
      version: versions.size === 1 ? ([...versions][0] ?? null) : null,
      members: listed.map(memberOf).filter((member) => member !== null),
      local,
    };
  }

  async saveMembers({
    version,
    members,
    local,
  }: StoredMembers & { version: string }): Promise<void> {
    const db = this.opened.db;
    if (!db) throw new Error('The local database is read-only');
    const ids = new Set([...members.map((member) => member.membershipId), ...Object.keys(local)]);
    await db.writeTransaction(async (tx) => {
      await tx.execute('DELETE FROM local_members');
      for (const id of ids) {
        const member = members.find((m) => m.membershipId === id);
        const mine = local[id];
        await tx.execute(
          `INSERT INTO local_members (id, listed, list_version, name, roles, permissions,
             pin_verifier, pin_disabled, failures, disabled_here, first_session_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            member ? 1 : 0,
            member ? version : null,
            member?.name ?? null,
            member ? JSON.stringify(member.roles) : null,
            member ? JSON.stringify(member.permissions) : null,
            member?.pinVerifier ?? null,
            member?.pinDisabled ? 1 : 0,
            mine?.failures ?? 0,
            mine?.disabled ? 1 : 0,
            mine?.firstSessionAt ?? null,
          ],
        );
      }
    });
  }

  destroy(): Promise<void> {
    return destroyLocalDatabase(this.directory, this.opened);
  }
}
