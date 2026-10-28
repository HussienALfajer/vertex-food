import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { staffMemberships } from './access.js';
import {
  archivedAt,
  createdAt,
  id,
  idIsUuidV7,
  tenantId,
  timestamptz,
  updatedAt,
} from './columns.js';
import { devices } from './identity.js';
import { branches } from './tenancy.js';

// The sync foundation (spec S04, ADR 0008, 0022, 0035). `command_log`, the certificates, the
// attention items and their resolutions are published to the sync service, which reads every
// column of a published table (its snapshot is `SELECT *`): what it must never read lives in an
// unpublished table beside them (`command_payloads`, `branch_ca_keys`).

const SHA256 = '^[0-9a-f]{64}$';
const COMMAND_NAME = '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$';
// `commandReasons` and `commandFlagSchema` in @vertex-food/contracts.
const REASONS = [
  'payload_invalid',
  'permission_missing',
  'pin_session_ended',
  'station_not_allowed',
  'unknown_command',
  'version_unsupported',
  'protocol_unsupported',
  'signature_invalid',
  'device_revoked',
  'member_inactive',
  'approver_not_allowed',
  'number_out_of_block',
  'server_error',
];
const FLAGS = ['clock_suspect', 'after_offline_window', 'from_quarantine', 'mirrored_false'];
const ATTENTION_KINDS = [
  'adjusted',
  'rejected',
  'replay_mismatch',
  'number_taken',
  'clock_suspect',
  'server_error',
];
const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * One row per command id, its first execution by the server (rules 7–13): who made, executed and
 * uploaded it, its journal position and times, and the recorded outcome. The id is the device's
 * UUIDv7. Commands are ordered by `(hub_epoch, hub_seq)` within a branch, never by `received_at`.
 */
export const commandLog = pgTable(
  'command_log',
  {
    /** The command id made on the device. */
    id: uuid().primaryKey(),
    tenantId: tenantId(),
    /** From the device token, never from the envelope. */
    branchId: uuid().notNull(),
    name: text().notNull(),
    version: smallint().notNull(),
    protocol: smallint().notNull(),
    originKind: text().notNull(),
    /** The PC, or the pairing id of a hub client (local to the hub, so no foreign key). */
    originDeviceId: uuid().notNull(),
    executedByDeviceId: uuid().notNull(),
    uploadedByDeviceId: uuid().notNull(),
    actorKind: text().notNull(),
    membershipId: uuid(),
    pairingId: uuid(),
    approvedByMembershipId: uuid(),
    hubEpoch: integer().notNull(),
    hubSeq: integer().notNull(),
    deviceTime: timestamptz().notNull(),
    clockOffsetMs: bigint({ mode: 'number' }).notNull(),
    effectiveTime: timestamptz().notNull(),
    /** The transaction start; never used to order commands. */
    receivedAt: timestamptz().notNull(),
    payloadHash: text().notNull(),
    outcome: text().notNull(),
    reason: text(),
    /** The adjustment or rejection, ids and codes only. */
    details: jsonb(),
    flags: text().array().notNull().default(sql`'{}'::text[]`),
    /** A re-run of a `server_error` command (rule 13). */
    linkedCommandId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('command_log', t.id),
    unique('command_log_tenant_id_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'command_log_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    foreignKey({
      name: 'command_log_executed_by_fk',
      columns: [t.tenantId, t.executedByDeviceId],
      foreignColumns: [devices.tenantId, devices.id],
    }),
    foreignKey({
      name: 'command_log_uploaded_by_fk',
      columns: [t.tenantId, t.uploadedByDeviceId],
      foreignColumns: [devices.tenantId, devices.id],
    }),
    foreignKey({
      name: 'command_log_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [staffMemberships.tenantId, staffMemberships.id],
    }),
    foreignKey({
      name: 'command_log_approved_by_fk',
      columns: [t.tenantId, t.approvedByMembershipId],
      foreignColumns: [staffMemberships.tenantId, staffMemberships.id],
    }),
    foreignKey({
      name: 'command_log_linked_command_fk',
      columns: [t.tenantId, t.linkedCommandId],
      foreignColumns: [t.tenantId, t.id] as [AnyPgColumn, AnyPgColumn],
    }),
    check(
      'command_log_name',
      sql`char_length(${t.name}) <= 80 and ${t.name} ~ ${sql.raw(`'${COMMAND_NAME}'`)}`,
    ),
    check('command_log_version', sql`${t.version} between 1 and 1000`),
    check('command_log_protocol', sql`${t.protocol} >= 1`),
    check('command_log_origin_kind', sql`${t.originKind} in ('pc', 'hub_client')`),
    // A member names a membership, a station its pairing, the PC itself neither.
    check(
      'command_log_actor',
      sql`case ${t.actorKind}
        when 'member' then ${t.membershipId} is not null and ${t.pairingId} is null
        when 'station' then ${t.pairingId} is not null and ${t.membershipId} is null
        when 'device' then ${t.membershipId} is null and ${t.pairingId} is null
        else false end`,
    ),
    check('command_log_journal', sql`${t.hubEpoch} >= 0 and ${t.hubSeq} >= 0`),
    check('command_log_effective_time', sql`${t.effectiveTime} <= ${t.receivedAt}`),
    check('command_log_payload_hash', sql`${t.payloadHash} ~ ${sql.raw(`'${SHA256}'`)}`),
    check('command_log_outcome', sql`${t.outcome} in ('accepted', 'adjusted', 'rejected')`),
    check(
      'command_log_reason',
      sql`(${t.reason} is null or ${t.reason} in (${list(REASONS)})) and (${t.outcome} <> 'rejected' or ${t.reason} is not null)`,
    ),
    check('command_log_flags', sql`${t.flags} <@ array[${list(FLAGS)}]::text[]`),
    check('command_log_linked', sql`${t.linkedCommandId} is distinct from ${t.id}`),
    index('command_log_tenant_branch_journal_idx').on(t.tenantId, t.branchId, t.hubEpoch, t.hubSeq),
    index('command_log_tenant_branch_received_idx').on(t.tenantId, t.branchId, t.receivedAt),
    index('command_log_tenant_executed_by_idx').on(t.tenantId, t.executedByDeviceId),
    index('command_log_tenant_uploaded_by_idx').on(t.tenantId, t.uploadedByDeviceId),
    index('command_log_tenant_membership_idx').on(t.tenantId, t.membershipId),
    index('command_log_tenant_approved_by_idx').on(t.tenantId, t.approvedByMembershipId),
    index('command_log_tenant_linked_command_idx').on(t.tenantId, t.linkedCommandId),
  ],
);

/**
 * The payload and the resolved version of each logged command, kept for replays, the quarantine
 * and audits (ADR 0016). Never published to the sync service and never logged: later specs'
 * payloads may hold customer data.
 */
export const commandPayloads = pgTable(
  'command_payloads',
  {
    id: id(),
    tenantId: tenantId(),
    commandId: uuid().notNull(),
    payload: jsonb().notNull(),
    resolved: jsonb().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('command_payloads', t.id),
    unique('command_payloads_tenant_command_unique').on(t.tenantId, t.commandId),
    foreignKey({
      name: 'command_payloads_command_fk',
      columns: [t.tenantId, t.commandId],
      foreignColumns: [commandLog.tenantId, commandLog.id],
    }),
    check(
      'command_payloads_objects',
      sql`jsonb_typeof(${t.payload}) = 'object' and jsonb_typeof(${t.resolved}) = 'object'`,
    ),
  ],
);

/**
 * A later arrival of a known command id with a different payload hash (rule 7). Identical replays
 * write nothing.
 */
export const commandReplays = pgTable(
  'command_replays',
  {
    id: id(),
    tenantId: tenantId(),
    commandId: uuid().notNull(),
    uploadedByDeviceId: uuid().notNull(),
    payloadHash: text().notNull(),
    payload: jsonb().notNull(),
    resolved: jsonb().notNull(),
    receivedAt: timestamptz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('command_replays', t.id),
    foreignKey({
      name: 'command_replays_command_fk',
      columns: [t.tenantId, t.commandId],
      foreignColumns: [commandLog.tenantId, commandLog.id],
    }),
    foreignKey({
      name: 'command_replays_uploaded_by_fk',
      columns: [t.tenantId, t.uploadedByDeviceId],
      foreignColumns: [devices.tenantId, devices.id],
    }),
    check('command_replays_payload_hash', sql`${t.payloadHash} ~ ${sql.raw(`'${SHA256}'`)}`),
    index('command_replays_tenant_command_idx').on(t.tenantId, t.commandId),
    index('command_replays_tenant_uploaded_by_idx').on(t.tenantId, t.uploadedByDeviceId),
  ],
);

/**
 * Numbers handed to a PC for one branch, series and business date (rules 17–20, ADR 0035): block
 * *n* is `(n−1)·5000 + 1` to `n·5000 − 1`. Never deleted or reused; a PC holds one block per series
 * and date.
 */
export const numberBlocks = pgTable(
  'number_blocks',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid().notNull(),
    series: text().notNull(),
    businessDate: date({ mode: 'string' }).notNull(),
    blockIndex: smallint().notNull(),
    firstNumber: integer().notNull(),
    lastNumber: integer().notNull(),
    deviceId: uuid().notNull(),
    allocatedAt: timestamptz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('number_blocks', t.id),
    unique('number_blocks_branch_block_unique').on(
      t.tenantId,
      t.branchId,
      t.series,
      t.businessDate,
      t.blockIndex,
    ),
    unique('number_blocks_device_date_unique').on(t.tenantId, t.deviceId, t.series, t.businessDate),
    foreignKey({
      name: 'number_blocks_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    foreignKey({
      name: 'number_blocks_device_fk',
      columns: [t.tenantId, t.deviceId],
      foreignColumns: [devices.tenantId, devices.id],
    }),
    check('number_blocks_series', sql`${t.series} in ('order')`),
    check(
      'number_blocks_layout',
      sql`${t.blockIndex} between 1 and 400 and ${t.firstNumber} = (${t.blockIndex} - 1) * 5000 + 1 and ${t.lastNumber} = ${t.blockIndex} * 5000 - 1`,
    ),
  ],
);

/** A hub-capable PC's latest heartbeat (rule 43), upserted by each one. */
export const deviceSyncStates = pgTable(
  'device_sync_states',
  {
    id: id(),
    tenantId: tenantId(),
    deviceId: uuid().notNull(),
    lastHeartbeatAt: timestamptz().notNull(),
    /** The last five round trips, restarted after a silence of 45 seconds. */
    recentRttMs: integer().array().notNull().default(sql`'{}'::integer[]`),
    pendingUploads: integer().notNull(),
    liveRole: text().notNull(),
    hubEpoch: integer().notNull(),
    standbyInSync: boolean(),
    appVersion: text().notNull(),
    protocol: smallint().notNull(),
    lanAddresses: inet().array().notNull().default(sql`'{}'::inet[]`),
    clockOffsetMs: bigint({ mode: 'number' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('device_sync_states', t.id),
    unique('device_sync_states_device_unique').on(t.tenantId, t.deviceId),
    foreignKey({
      name: 'device_sync_states_device_fk',
      columns: [t.tenantId, t.deviceId],
      foreignColumns: [devices.tenantId, devices.id],
    }),
    check(
      'device_sync_states_recent_rtt',
      sql`cardinality(${t.recentRttMs}) <= 5 and 0 <= all(${t.recentRttMs})`,
    ),
    check('device_sync_states_pending', sql`${t.pendingUploads} >= 0 and ${t.hubEpoch} >= 0`),
    check(
      'device_sync_states_live_role',
      sql`${t.liveRole} in ('hub', 'standby', 'client', 'rejoining')`,
    ),
    check('device_sync_states_app_version', sql`char_length(${t.appVersion}) between 1 and 50`),
    check('device_sync_states_lan_addresses', sql`cardinality(${t.lanAddresses}) <= 8`),
  ],
);

/** A branch's connectivity (rule 44, ADR 0035), moved by heartbeats and the sweep job. */
export const branchConnectivity = pgTable(
  'branch_connectivity',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid().notNull(),
    state: text().notNull(),
    since: timestamptz().notNull(),
    healthyStreak: smallint().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('branch_connectivity', t.id),
    unique('branch_connectivity_branch_unique').on(t.tenantId, t.branchId),
    foreignKey({
      name: 'branch_connectivity_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    check('branch_connectivity_state', sql`${t.state} in ('online', 'weak', 'offline')`),
    check('branch_connectivity_streak', sql`${t.healthyStreak} between 0 and 5`),
  ],
);

/** Every change of a branch's connectivity, published as `branch.connectivity_changed.v1`. */
export const branchConnectivityChanges = pgTable(
  'branch_connectivity_changes',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid().notNull(),
    fromState: text().notNull(),
    toState: text().notNull(),
    at: timestamptz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('branch_connectivity_changes', t.id),
    foreignKey({
      name: 'branch_connectivity_changes_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    check(
      'branch_connectivity_changes_states',
      sql`${t.fromState} in ('online', 'weak', 'offline') and ${t.toState} in ('online', 'weak', 'offline') and ${t.fromState} <> ${t.toState}`,
    ),
    index('branch_connectivity_changes_tenant_branch_at_idx').on(t.tenantId, t.branchId, t.at),
  ],
);

/**
 * A branch's certificate authority (rule 38, ADR 0035): ECDSA P-256, 10 years, created at the
 * branch's first PC registration. One active per branch; a retired one is archived. Its sealed
 * private key is in `branch_ca_keys`, which the sync service never reads.
 */
export const branchCertificateAuthorities = pgTable(
  'branch_certificate_authorities',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid().notNull(),
    certificatePem: text().notNull(),
    fingerprintSha256: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Retired. */
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('branch_certificate_authorities', t.id),
    unique('branch_certificate_authorities_tenant_id_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'branch_certificate_authorities_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    check(
      'branch_certificate_authorities_fingerprint',
      sql`${t.fingerprintSha256} ~ ${sql.raw(`'${SHA256}'`)}`,
    ),
    check(
      'branch_certificate_authorities_pem',
      sql`${t.certificatePem} like '-----BEGIN CERTIFICATE-----%'`,
    ),
    index('branch_certificate_authorities_tenant_branch_idx').on(t.tenantId, t.branchId),
    uniqueIndex('branch_certificate_authorities_active_unique')
      .on(t.tenantId, t.branchId)
      .where(sql`${t.archivedAt} is null`),
  ],
);

/** The sealed private key of a branch CA (`SecretBox`, context `sync.branch-ca`). */
export const branchCaKeys = pgTable(
  'branch_ca_keys',
  {
    id: id(),
    tenantId: tenantId(),
    authorityId: uuid().notNull(),
    privateKeySealed: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('branch_ca_keys', t.id),
    unique('branch_ca_keys_authority_unique').on(t.tenantId, t.authorityId),
    foreignKey({
      name: 'branch_ca_keys_authority_fk',
      columns: [t.tenantId, t.authorityId],
      foreignColumns: [branchCertificateAuthorities.tenantId, branchCertificateAuthorities.id],
    }),
    check('branch_ca_keys_sealed', sql`${t.privateKeySealed} like 'v1.%'`),
  ],
);

/** A PC certificate (rule 39): the newest unexpired row is the PC's certificate. */
export const deviceCertificates = pgTable(
  'device_certificates',
  {
    id: id(),
    tenantId: tenantId(),
    deviceId: uuid().notNull(),
    certificatePem: text().notNull(),
    fingerprintSha256: text().notNull(),
    lanAddresses: inet().array().notNull(),
    issuedAt: timestamptz().notNull(),
    expiresAt: timestamptz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('device_certificates', t.id),
    foreignKey({
      name: 'device_certificates_device_fk',
      columns: [t.tenantId, t.deviceId],
      foreignColumns: [devices.tenantId, devices.id],
    }),
    check(
      'device_certificates_fingerprint',
      sql`${t.fingerprintSha256} ~ ${sql.raw(`'${SHA256}'`)}`,
    ),
    check('device_certificates_pem', sql`${t.certificatePem} like '-----BEGIN CERTIFICATE-----%'`),
    check('device_certificates_lan_addresses', sql`cardinality(${t.lanAddresses}) between 1 and 8`),
    check('device_certificates_validity', sql`${t.expiresAt} > ${t.issuedAt}`),
    index('device_certificates_tenant_device_issued_idx').on(t.tenantId, t.deviceId, t.issuedAt),
  ],
);

/**
 * Commands held for the owner (rules 16, 40–42): a revoked PC's pending work, one batch per
 * revocation, or a deactivated member's commands that rule 16 could not run. The batch is fixed
 * once written; its commands are in `quarantine_commands` and its decision in
 * `quarantine_decisions`.
 */
export const quarantineBatches = pgTable(
  'quarantine_batches',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid().notNull(),
    deviceId: uuid().notNull(),
    reason: text().notNull(),
    /** The member, for `member_inactive`. */
    membershipId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('quarantine_batches', t.id),
    unique('quarantine_batches_tenant_id_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'quarantine_batches_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    foreignKey({
      name: 'quarantine_batches_device_fk',
      columns: [t.tenantId, t.deviceId],
      foreignColumns: [devices.tenantId, devices.id],
    }),
    foreignKey({
      name: 'quarantine_batches_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [staffMemberships.tenantId, staffMemberships.id],
    }),
    check(
      'quarantine_batches_reason',
      sql`(${t.reason} = 'device_revoked' and ${t.membershipId} is null) or (${t.reason} = 'member_inactive' and ${t.membershipId} is not null)`,
    ),
    index('quarantine_batches_tenant_branch_created_idx').on(t.tenantId, t.branchId, t.createdAt),
    index('quarantine_batches_tenant_device_idx').on(t.tenantId, t.deviceId),
    index('quarantine_batches_tenant_membership_idx').on(t.tenantId, t.membershipId),
    // One batch per revocation: later uploads answer it.
    uniqueIndex('quarantine_batches_revoked_device_unique')
      .on(t.tenantId, t.deviceId)
      .where(sql`${t.reason} = 'device_revoked'`),
  ],
);

/** A quarantined command with its full signed envelope; a command id is quarantined once. */
export const quarantineCommands = pgTable(
  'quarantine_commands',
  {
    id: id(),
    tenantId: tenantId(),
    batchId: uuid().notNull(),
    commandId: uuid().notNull(),
    envelope: jsonb().notNull(),
    receivedAt: timestamptz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('quarantine_commands', t.id),
    unique('quarantine_commands_command_unique').on(t.tenantId, t.commandId),
    foreignKey({
      name: 'quarantine_commands_batch_fk',
      columns: [t.tenantId, t.batchId],
      foreignColumns: [quarantineBatches.tenantId, quarantineBatches.id],
    }),
    check('quarantine_commands_envelope', sql`jsonb_typeof(${t.envelope}) = 'object'`),
    index('quarantine_commands_tenant_batch_idx').on(t.tenantId, t.batchId),
  ],
);

/** The owner's decision on a batch (rule 41): once, with a reason for a rejection. */
export const quarantineDecisions = pgTable(
  'quarantine_decisions',
  {
    id: id(),
    tenantId: tenantId(),
    batchId: uuid().notNull(),
    decision: text().notNull(),
    reason: text(),
    decidedByMembershipId: uuid().notNull(),
    decidedAt: timestamptz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('quarantine_decisions', t.id),
    unique('quarantine_decisions_batch_unique').on(t.tenantId, t.batchId),
    foreignKey({
      name: 'quarantine_decisions_batch_fk',
      columns: [t.tenantId, t.batchId],
      foreignColumns: [quarantineBatches.tenantId, quarantineBatches.id],
    }),
    foreignKey({
      name: 'quarantine_decisions_decided_by_fk',
      columns: [t.tenantId, t.decidedByMembershipId],
      foreignColumns: [staffMemberships.tenantId, staffMemberships.id],
    }),
    check(
      'quarantine_decisions_decision',
      sql`(${t.decision} = 'accept' and ${t.reason} is null) or (${t.decision} = 'reject' and char_length(${t.reason}) between 3 and 500 and ${t.reason} = btrim(${t.reason}))`,
    ),
    index('quarantine_decisions_tenant_decided_by_idx').on(t.tenantId, t.decidedByMembershipId),
  ],
);

/** A command that needs a person (rule 47): one item per command and kind, open until resolved. */
export const attentionItems = pgTable(
  'attention_items',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid().notNull(),
    commandId: uuid().notNull(),
    kind: text().notNull(),
    /** The member who made the command; null for a station or the PC itself. */
    membershipId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('attention_items', t.id),
    unique('attention_items_tenant_id_id_unique').on(t.tenantId, t.id),
    unique('attention_items_command_kind_unique').on(t.tenantId, t.commandId, t.kind),
    foreignKey({
      name: 'attention_items_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    foreignKey({
      name: 'attention_items_command_fk',
      columns: [t.tenantId, t.commandId],
      foreignColumns: [commandLog.tenantId, commandLog.id],
    }),
    foreignKey({
      name: 'attention_items_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [staffMemberships.tenantId, staffMemberships.id],
    }),
    check('attention_items_kind', sql`${t.kind} in (${list(ATTENTION_KINDS)})`),
    index('attention_items_tenant_branch_created_idx').on(t.tenantId, t.branchId, t.createdAt),
    index('attention_items_tenant_membership_idx').on(t.tenantId, t.membershipId),
  ],
);

/** An attention item closed by an owner or manager with a written reason (audited). */
export const attentionResolutions = pgTable(
  'attention_resolutions',
  {
    id: id(),
    tenantId: tenantId(),
    itemId: uuid().notNull(),
    reason: text().notNull(),
    resolvedByMembershipId: uuid().notNull(),
    resolvedAt: timestamptz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('attention_resolutions', t.id),
    unique('attention_resolutions_item_unique').on(t.tenantId, t.itemId),
    foreignKey({
      name: 'attention_resolutions_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [attentionItems.tenantId, attentionItems.id],
    }),
    foreignKey({
      name: 'attention_resolutions_resolved_by_fk',
      columns: [t.tenantId, t.resolvedByMembershipId],
      foreignColumns: [staffMemberships.tenantId, staffMemberships.id],
    }),
    check(
      'attention_resolutions_reason',
      sql`char_length(${t.reason}) between 3 and 500 and ${t.reason} = btrim(${t.reason})`,
    ),
    index('attention_resolutions_tenant_resolved_by_idx').on(t.tenantId, t.resolvedByMembershipId),
  ],
);
