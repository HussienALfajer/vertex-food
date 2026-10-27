import {
  deviceNameSchema,
  idSchema,
  pinSchema,
  type StaffPermission,
  type StaffRole,
  staffPermissionSchema,
  type TenantStatus,
} from '@vertex-food/contracts';
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
  /** Disabled online (rule 24) or on this PC (rule 25). */
  pinDisabled: boolean;
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

/** The IPC channels; the preload names the same ones (`preload.cts`, checked by a test). */
export const deviceChannels = {
  status: 'device:status',
  register: 'device:register',
  signIn: 'device:sign-in',
  lock: 'device:lock',
  accessToken: 'device:access-token',
  refresh: 'device:refresh',
  approve: 'device:approve',
  reenablePin: 'device:reenable-pin',
  dismissWipe: 'device:dismiss-wipe',
  changed: 'device:changed',
} as const;
