import type {
  ConnectivityState,
  DeviceMember,
  LocalDate,
  NumberSeries,
  PairingKind,
  TimeOfDay,
} from '@vertex-food/contracts';
import type { LocalEvent } from '../commands/audit.js';
import type { VerifyMessage } from '../envelope.js';
import type { JournalEntry, NumberUse } from './journal.js';

// The ports of the hub (spec S04, ADR 0022): what the hub logic needs from the PC it runs on. S04's
// PR 5 implements them on the encrypted local database, the HTTPS LAN server and the device keys;
// the tests implement them in memory (`src/test-support/`). Nothing here imports a runtime.

/** The PC's clock and what S02 and rule 14 keep about it. */
export interface HubClock {
  now(): Date;
  /** The last measured server time minus device time (rule 14). */
  offsetMs(): number;
  /** The highest time the PC has seen (S02 rule 31). */
  highestSeenTime(): Date;
}

/** Randomness the hub hands out; a real PC uses its cryptographic generator. */
export interface HubRandom {
  /** A UUIDv7. */
  id(): string;
  /** A bearer token of at least 256 random bits, URL-safe. */
  token(): string;
  /** A 6-digit pairing code. */
  pairingCode(): string;
}

/** The role a PC holds in the hub protocol; `none` once revoked or removed from its role. */
export type HubNodeRole = 'hub' | 'standby' | 'none';

/** Why a PC cannot follow the hub on its own (rules 27, 29); the screens show it. */
export type HubNotice = 'too_far_behind' | 'needs_other_pc';

/** `hub_state`: the PC's live role, saved with every change of it. */
export type HubState = {
  role: HubNodeRole;
  epoch: number;
  /** The highest sequence of the hub's lineage this PC holds. */
  appliedSeq: number;
  hubDeviceId: string | null;
  /** Saved with the role on a demotion; cleared when every own-lineage entry is forwarded. */
  rejoining: boolean;
  /** The latest sequence the hub reported; promotion needs every entry up to it (rule 22). */
  hubSeq: number;
  lastHeartbeatAt: string | null;
  notice: HubNotice | null;
};

/** `number_blocks_local`: one of this PC's own blocks and the last number used from it. */
export type LocalNumberBlock = {
  series: NumberSeries;
  businessDate: LocalDate;
  first: number;
  last: number;
  lastUsed: number | null;
};

/** `hub_pairings`, with what each PC learns from the other about its use (rule 34). */
export type PairingRecord = {
  id: string;
  kind: PairingKind;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastUsedAt: string;
  revokedAt: string | null;
};

/** A member's PIN session on a personal pairing (rule 35). */
export type SessionRecord = {
  id: string;
  pairingId: string;
  membershipId: string;
  tokenHash: string;
  startedAt: string;
  lastInputAt: string;
  endedAt: string | null;
};

/** What the hub reads from the PC's local database. */
export interface HubReads {
  loadState(): Promise<HubState | null>;
  /** The entry of a command or local entry id, in the lineage or not. */
  entry(id: string): Promise<JournalEntry | null>;
  /** The lineage's entry at a sequence number (not an own-lineage one). */
  entryAt(seq: number): Promise<JournalEntry | null>;
  /** The lineage's entries after `seq`, in order, at most `limit` of them. */
  entriesAfter(seq: number, limit?: number): Promise<JournalEntry[]>;
  /** Own-lineage entries (rule 24), by their old sequence. */
  ownLineage(): Promise<JournalEntry[]>;
  /** The lineage's lowest sequence still kept (rule 29), or null when it is empty. */
  oldestSeq(): Promise<number | null>;
  /** The latest `limit` command entries of one command name, newest first (the live snapshot). */
  recentCommands(name: string, limit: number): Promise<JournalEntry[]>;
  localBlock(series: NumberSeries, businessDate: LocalDate): Promise<LocalNumberBlock | null>;
  pairings(): Promise<PairingRecord[]>;
  sessions(): Promise<SessionRecord[]>;
  /** Another entry than `exceptId` holds this number (rules 18, 26). */
  numberTaken(use: NumberUse, exceptId: string): Promise<boolean>;
  /** PINs disabled by this hub or its standby (rule 35). */
  pinDisabled(membershipId: string): Promise<boolean>;
  /**
   * The command was uploaded from this PC and its outcome arrived (`command_log`); a local entry
   * is always settled. Retention keeps everything else (rule 29).
   */
  isSettled(id: string): Promise<boolean>;
}

/** One local transaction: everything in it is written, or nothing (ADR 0022). */
export interface HubTransaction extends HubReads {
  saveState(state: HubState): Promise<void>;
  /**
   * Appends an entry. For a command: its optimistic rows, its journal row, its upload-queue row
   * (the envelope with `mirrored`, `uploadedCommandSchema`) and its `command_results` row. For a
   * local entry: its pairing, session or lockout row. A number it used advances this PC's counter
   * when this PC executed it (rule 18).
   */
  appendEntry(entry: JournalEntry): Promise<void>;
  /** The hub's copy of an entry this PC holds arrived: its place in the lineage (rule 24). */
  moveEntry(id: string, seq: number, epoch: number): Promise<void>;
  /**
   * Divergence adopted (rule 25): the hub's version of a command this PC holds with another hash
   * replaces its optimistic rows, its journal row and its queued command.
   */
  replaceEntry(entry: JournalEntry): Promise<void>;
  markOwnLineage(ids: readonly string[]): Promise<void>;
  markForwarded(ids: readonly string[], at: string): Promise<void>;
  /** Retention (rule 29): drops settled entries from the journal; their rows stay. */
  deleteEntries(ids: readonly string[]): Promise<void>;
  touchPairing(id: string, at: string): Promise<void>;
  revokePairing(id: string, at: string): Promise<void>;
  touchSession(id: string, at: string): Promise<void>;
  endSession(id: string, at: string): Promise<void>;
  /** `local_events`, uploaded by `audit.record_local_events`. */
  recordLocalEvent(event: LocalEvent): Promise<void>;
}

export interface HubStore extends HubReads {
  transaction<T>(work: (tx: HubTransaction) => Promise<T>): Promise<T>;
}

/** The branch member list on this PC (`local_members`, S02 rule 29). */
export interface MemberDirectory {
  members(): readonly DeviceMember[];
  member(membershipId: string): DeviceMember | null;
  /** Checks a PIN against its Argon2id verifier (hub client sessions count failures themselves). */
  verifyPin(verifier: string, pin: string): Promise<boolean>;
  /**
   * S02's PIN check on this PC, with its local lockout (5 wrong PINs) and its offline audit
   * events: the manual promotion's PIN (rule 27).
   */
  checkPcPin(membershipId: string, pin: string): Promise<'ok' | 'invalid' | 'disabled'>;
}

/** What the hub reads from the branch's synced data. */
export interface BranchData {
  businessDayEndsAt(): TimeOfDay;
  idleLockMinutes(): number;
  connectivity(): ConnectivityState;
  /** The PC's offline window closed (S02 rule 30): commands carry `afterOfflineWindow`. */
  afterOfflineWindow(): boolean;
  /** A hub-capable PC's block of a date, from the synced `number_blocks` (rule 26). */
  numberBlockOf(
    deviceId: string,
    series: NumberSeries,
    businessDate: LocalDate,
  ): { first: number; last: number } | null;
  /** The public key of an active hub-capable PC of the branch (rule 26), else null. */
  verifierOf(deviceId: string): VerifyMessage | null;
  /** The branch CA's SHA-256 fingerprint, for the pairing answer (rule 37). */
  caFingerprint(): string;
  /**
   * Whether the branch's last synced entitlement copy has `feature` on at `at` (spec S05 rule 24,
   * `isBranchFeatureEntitled`). Read whatever the lease: the hub never refuses for an expired one.
   */
  featureEntitled(feature: string, at: Date): boolean;
}
