import {
  type BranchEntitledFeature,
  type ConnectivityState,
  deviceNameSchema,
  type HubPairing,
  idSchema,
  mobilePhoneNumberSchema,
  type NetworkCheckRecord,
  type OpenPairing,
  passwordPolicy,
  pinSchema,
  proofOfWorkSolutionSchema,
  type StaffPermission,
  type StaffRole,
  staffPermissionSchema,
  type TenantStatus,
} from '@vertex-food/contracts';
import { type HubStatus, MAX_NETWORK_CHECK_SEQUENCE } from '@vertex-food/sync';
import { z } from 'zod';

/**
 * The narrow API the preload gives the renderer (`window.vertexDevice`): the PC's registration,
 * its PIN sessions, approvals and the wipe (spec S02 rules 16–33). It never carries a PIN
 * verifier, the device key, a device token or a refresh token: those stay in the main process
 * (rule 29). The renderer is untrusted, so the main process parses every input again.
 */

/** A member as the lock screen shows them: no verifier. */
export type DeviceMemberView = {
  membershipId: string;
  name: string;
  roles: StaffRole[];
  permissions: StaffPermission[];
  hasPin: boolean;
  /** Disabled online after 10 wrong PINs (rule 24): only a PIN reset online brings it back. */
  pinDisabledOnline: boolean;
  /** Disabled on this PC after 5 wrong PINs (rule 25): a manager re-enables it here. */
  pinDisabledHere: boolean;
  /** Opened a PIN session on this PC before: may sign in after the window (rule 30). */
  usedThisDevice: boolean;
};

export type DeviceWindowView = {
  open: boolean;
  daysSinceSync: number;
  warn: boolean;
  clockBehind: boolean;
};

export type DeviceSessionView = {
  membershipId: string;
  /** Opened online, with an access token for the API; offline sessions have none (rule 25). */
  online: boolean;
  /**
   * Opened by password to replace a forgotten PIN (rule 22): the member chooses a new PIN before
   * anything else; it clears once the member list carries the new one.
   */
  choosePin: boolean;
};

export type DeviceStatus =
  | { state: 'unregistered' }
  /** Revoked and wiped (rule 19): only the notice is left. */
  | { state: 'wiped'; tenantName: string }
  | {
      state: 'registered';
      tenant: { id: string; nameAr: string; status: TenantStatus; logoFileId: string | null };
      branch: { id: string; nameAr: string; idleLockMinutes: number };
      device: { id: string; name: string };
      members: DeviceMemberView[];
      window: DeviceWindowView;
      /** The last request to the API was answered. */
      online: boolean;
      /**
       * The local database failed `integrity_check` and is open read-only (spec S04 "Abuse and
       * failure cases"): the screens show the corrupt-database notice.
       */
      localDatabase?: 'corrupt';
      session: DeviceSessionView | null;
    };

/** An action's outcome: the code of a refusal, as the API's or the local check's. */
export type BridgeResult = { ok: true } | { ok: false; code: string };

export const registerInputSchema = z.object({
  ticket: z.string().min(1).max(4000),
  tenantId: idSchema,
  branchId: idSchema,
  name: deviceNameSchema,
});

export type RegisterInput = z.infer<typeof registerInputSchema>;

export const signInInputSchema = z.object({ membershipId: idSchema, pin: pinSchema });

export type SignInInput = z.infer<typeof signInInputSchema>;

/**
 * Rule 22: an owner or manager who forgot their PIN enters their phone and password here; the
 * main process signs in with the PC's device token (so no OTP) and opens their session by ticket.
 */
export const passwordSignInInputSchema = z.object({
  membershipId: idSchema,
  phone: mobilePhoneNumberSchema,
  password: z.string().min(1).max(passwordPolicy.maxLength),
  proofOfWork: proofOfWorkSolutionSchema,
});

export type PasswordSignInInput = z.infer<typeof passwordSignInInputSchema>;

export const lockReasonSchema = z.enum(['signed_out', 'locked', 'idle']);

export type LockReason = z.infer<typeof lockReasonSchema>;

export const approveInputSchema = z.object({
  permission: staffPermissionSchema,
  actingMembershipId: idSchema,
  approverMembershipId: idSchema,
  pin: pinSchema,
});

export type ApproveInput = z.infer<typeof approveInputSchema>;

export const reenableInputSchema = z.object({
  membershipId: idSchema,
  managerMembershipId: idSchema,
  pin: pinSchema,
});

export type ReenableInput = z.infer<typeof reenableInputSchema>;

export type DeviceBridge = {
  status(): Promise<DeviceStatus>;
  /** Registers this PC with a `signed_in` ticket and opens the registering member's session. */
  register(input: RegisterInput): Promise<BridgeResult>;
  /** A PIN session: online when the API answers, otherwise checked here (rules 24, 25, 30). */
  signIn(input: SignInInput): Promise<BridgeResult>;
  /** Rule 22: an owner's or manager's session by password, online only, to choose a new PIN. */
  signInByPassword(input: PasswordSignInInput): Promise<BridgeResult>;
  /** Locks the PC: the session ends (rule 32). */
  lock(reason: LockReason): Promise<void>;
  /** The online session's access token, refreshed when due; null offline or without one. */
  accessToken(): Promise<string | null>;
  /** Fetches the member list now (after a PIN is set, on reconnect). */
  refresh(): Promise<void>;
  approve(input: ApproveInput): Promise<BridgeResult>;
  reenablePin(input: ReenableInput): Promise<BridgeResult>;
  /** Forgets the wipe notice: the PC is unregistered. */
  dismissWipe(): Promise<void>;
  /** Called whenever the status may have changed; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
};

// Spec S04's screens (1–5): the sync status, the branch network and this PC's own results. Ids,
// codes, counts and times only: no payload, token, key or verifier crosses (ADR 0016).

/** A refusal's code, or the value. */
export type BridgeValue<T> = { ok: true; value: T } | { ok: false; code: string };

/** The sync client's state (`SyncService`). */
export type SyncState = {
  connectivity: ConnectivityState | null;
  lastHeartbeatAt: string | null;
  /** Below the minimum app version (rule 45): uploads go on, downloads stop. */
  updateRequired: boolean;
  /**
   * The server refused this app's sync protocol: nothing uploads until a heartbeat lists it again
   * or the app is updated (with an empty queue only, rule 46).
   */
  protocolRefused: boolean;
};

/** What the sync status shows (screen 1): the state, the queue and PowerSync's last checkpoint. */
export type SyncView = SyncState & {
  /** Commands waiting to upload; null when the queue cannot be read (a damaged database). */
  pendingUploads: number | null;
  lastSyncedAt: string | null;
  /** PowerSync's stream is open. */
  connected: boolean;
};

/** The hub as the screens show it (screens 1, 2; `HubRuntime`). */
export type HubView = {
  /** Null before the PC knows its role (its first sync), and on a client PC. */
  status: HubStatus | null;
  configuredRole: 'hub' | 'standby' | null;
  /** The PC's current addresses are not all in its certificate (rule 39). */
  addressChanged: boolean;
  pairingOpen: boolean;
  /** This PC's own commands not yet answered by a hub, and answered without a standby copy. */
  outbox: { sending: number; unmirrored: number };
};

/** A PC of the branch as the synced tables show it. */
export type BranchPc = {
  deviceId: string;
  name: string;
  active: boolean;
  hubRole: 'hub' | 'standby' | null;
  publicKey: string | null;
  /** The private addresses of its newest unexpired certificate. */
  addresses: string[];
};

export type BranchNetworkView = {
  pcs: (BranchPc & { self: boolean })[];
  pairings: HubPairing[];
  networkChecks: NetworkCheckRecord[];
};

export type OpenedPairing = {
  code: string;
  closesAt: string;
  caFingerprint: string;
  /** `https://<hub>:7443/pair#peers=…&fp=…&code=…` (rule 37). */
  pairingUrl: string;
  /** `http://<hub>:7080/ca.crt`, served while pairing is open. */
  caUrl: string;
};

export type SyncStatusView = {
  sync: SyncView;
  /** Null while the PC has no hub runtime (unregistered, or its database is read-only). */
  hub: HubView | null;
  /** A downloaded update waiting for the next start (rule 46). */
  updateReady: { version: string } | null;
};

/** One command this PC made or executed, with the server's outcome once it arrived (rule 11). */
export type CommandResultView = {
  id: string;
  name: string | null;
  membershipId: string | null;
  outcome: string | null;
  reason: string | null;
  madeAt: string | null;
  answeredAt: string | null;
};

/**
 * The branch's entitlements as this PC last synced them (spec S05 rules 24, 26): feature keys and
 * limits, never a price or commission. The renderer hides what is off (cosmetic) and shows the
 * banners; the hub decides from the same row.
 */
export type BranchEntitlementsView = {
  /** Null until the stream has brought the branch's row. */
  copy: {
    version: number;
    /** The entitled features, with `until` when a removal is scheduled. */
    features: BranchEntitledFeature[];
    /** The set limits; an absent key is unlimited. */
    limits: Record<string, number>;
    updatedAt: string | null;
  } | null;
  /** PowerSync's last complete checkpoint, which the lease runs from. */
  lastSyncedAt: string | null;
  /** More than 7 days since that sync: the banner shows and nothing stops (rule 26). */
  leaseExpired: boolean;
};

export const promoteInputSchema = z.object({
  membershipId: idSchema,
  pin: pinSchema,
  acknowledgedMissing: z.int().min(0),
});

export const networkCheckInputSchema = z.object({
  run: idSchema,
  sequence: z.int().min(1).max(MAX_NETWORK_CHECK_SEQUENCE),
});

export type SyncBridge = {
  status(): Promise<SyncStatusView | null>;
  /** The branch's PCs, the paired devices and the recent network checks (screen 2). */
  network(): Promise<BranchNetworkView | null>;
  /** Rule 33: on the active hub, by a PIN session with `hub.manage`. */
  openPairing(input: OpenPairing): Promise<BridgeValue<OpenedPairing>>;
  closePairing(): Promise<void>;
  revokePairing(pairingId: string): Promise<BridgeResult>;
  /** The manual promotion's warning: the entries this standby lacks (rule 27). */
  promotionPreview(): Promise<BridgeValue<{ missing: number; rejoining: boolean }>>;
  promote(input: z.infer<typeof promoteInputSchema>): Promise<BridgeResult>;
  sendNetworkCheck(
    input: z.infer<typeof networkCheckInputSchema>,
  ): Promise<BridgeValue<{ commandId: string }>>;
  /** This PC's commands and their outcomes, newest first (needs attention, screen 3). */
  results(): Promise<CommandResultView[]>;
  /** The branch's last synced entitlements and the lease; null before the PC has local data. */
  entitlements(): Promise<BranchEntitlementsView | null>;
  onChange(listener: () => void): () => void;
};

export const syncChannels = {
  status: 'sync:status',
  network: 'sync:network',
  openPairing: 'sync:open-pairing',
  closePairing: 'sync:close-pairing',
  revokePairing: 'sync:revoke-pairing',
  promotionPreview: 'sync:promotion-preview',
  promote: 'sync:promote',
  sendNetworkCheck: 'sync:send-network-check',
  results: 'sync:results',
  entitlements: 'sync:entitlements',
  changed: 'sync:changed',
} as const;

/** The IPC channels; the preload names the same ones (`preload.cts`, checked by a test). */
export const deviceChannels = {
  status: 'device:status',
  register: 'device:register',
  signIn: 'device:sign-in',
  signInByPassword: 'device:sign-in-by-password',
  lock: 'device:lock',
  accessToken: 'device:access-token',
  refresh: 'device:refresh',
  approve: 'device:approve',
  reenablePin: 'device:reenable-pin',
  dismissWipe: 'device:dismiss-wipe',
  changed: 'device:changed',
} as const;
