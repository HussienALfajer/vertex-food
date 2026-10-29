import { z } from 'zod';
import { DomainError } from './errors.js';
import { EXPORT_FORMAT_VERSION } from './export-csv.js';
import { idSchema, instantSchema } from './primitives.js';
import { addDays, businessInstant, businessWallClock } from './time.js';

/**
 * The data export of a restaurant (spec S06, ADR 0016, 0037): everything the tenant holds, as a
 * ZIP of CSV files built in the background, kept 7 days and downloaded through short-lived links.
 */
export const dataExportPolicy = {
  /** Requests per tenant per Damascus calendar day, failed ones not counted (rule 8). */
  dailyLimit: 3,
  /** A ready file is kept this long (rule 14). */
  retentionDays: 7,
  /** A download link lives this long (rule 16). */
  linkMinutes: 10,
  /** The largest file built (rule 12). */
  maxBytes: 1024 ** 3,
  /** The longest build (rule 12). */
  maxBuildMinutes: 30,
  /** Build attempts before `server_error` (rule 12). */
  maxAttempts: 3,
  /** The size of every stored chunk but the last. */
  chunkBytes: 1024 ** 2,
  /** Exports per page of the history. */
  pageSize: 20,
} as const;

export const dataExportStatuses = ['queued', 'running', 'ready', 'failed', 'expired'] as const;

export const dataExportStatusSchema = z.enum(dataExportStatuses).meta({ id: 'DataExportStatus' });

export type DataExportStatus = z.infer<typeof dataExportStatusSchema>;

export const dataExportFailureSchema = z
  .enum(['too_large', 'timed_out', 'server_error'])
  .meta({ id: 'DataExportFailure' });

export type DataExportFailure = z.infer<typeof dataExportFailureSchema>;

/** The statuses that hold a tenant's one active export (rule 7). */
export const activeDataExportStatuses = ['queued', 'running'] as const satisfies DataExportStatus[];

/** Export states (spec S06 "Export states"); `failed` and `expired` are final. */
const dataExportTransitions: Record<DataExportStatus, readonly DataExportStatus[]> = {
  queued: ['running', 'failed'],
  running: ['ready', 'failed'],
  ready: ['expired'],
  failed: [],
  expired: [],
};

export function canMoveDataExport(from: DataExportStatus, to: DataExportStatus): boolean {
  return dataExportTransitions[from].includes(to);
}

/** Refuses a move the table does not allow: a job's bug, never a person's request. */
export function assertDataExportMove(from: DataExportStatus, to: DataExportStatus): void {
  if (!canMoveDataExport(from, to)) {
    throw new Error(`A data export cannot move from ${from} to ${to}`);
  }
}

/** The Damascus calendar day holding `now`, as instants `[start, end)` (rule 8, edge case 6). */
export function damascusDay(now: Date): { start: Date; end: Date } {
  const { date } = businessWallClock(now);
  return { start: businessInstant(date, '00:00'), end: businessInstant(addDays(date, 1), '00:00') };
}

/**
 * What is left of today's requests (rule 8), from the request times of the tenant's exports that
 * did not fail: the remaining count and, at the limit, when the next request is allowed (the next
 * Damascus midnight).
 */
export function dataExportAllowance(
  requestedAtNotFailed: readonly Date[],
  now: Date,
): { remainingToday: number; nextAllowedAt: Date | null } {
  const { start, end } = damascusDay(now);
  const today = requestedAtNotFailed.filter(
    (at) => at.getTime() >= start.getTime() && at.getTime() < end.getTime(),
  ).length;
  const remainingToday = Math.max(0, dataExportPolicy.dailyLimit - today);
  return { remainingToday, nextAllowedAt: remainingToday === 0 ? end : null };
}

/** Refuses a request past the daily limit with `EXPORT_LIMIT_REACHED` and `nextAllowedAt`. */
export function assertDataExportAllowed(requestedAtNotFailed: readonly Date[], now: Date): void {
  const { remainingToday, nextAllowedAt } = dataExportAllowance(requestedAtNotFailed, now);
  if (remainingToday === 0 && nextAllowedAt) {
    throw new DomainError('EXPORT_LIMIT_REACHED', 'Three exports were requested today', {
      nextAllowedAt: nextAllowedAt.toISOString(),
    });
  }
}

/** `vertex-food-<slug>-<YYYYMMDD-HHmm>.zip`, on the Damascus clock of `asOf`. */
export function dataExportFileName(slug: string, asOf: Date): string {
  const { date, minutes } = businessWallClock(asOf);
  const pad = (value: number) => String(value).padStart(2, '0');
  const clock = `${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}`;
  return `vertex-food-${slug}-${date.replaceAll('-', '')}-${clock}.zip`;
}

/** When a ready file expires (rule 14). */
export function dataExportExpiresAt(finishedAt: Date): Date {
  return new Date(finishedAt.getTime() + dataExportPolicy.retentionDays * 86_400_000);
}

/** An export as the owner sees it (`POST`, `GET /api/tenant/data-exports[/:id]`). */
export const dataExportSchema = z
  .object({
    id: idSchema,
    status: dataExportStatusSchema,
    formatVersion: z.literal(EXPORT_FORMAT_VERSION),
    requestedBy: z.object({ accountId: idSchema, name: z.string().nullable() }),
    requestedAt: instantSchema,
    startedAt: instantSchema.nullable(),
    finishedAt: instantSchema.nullable(),
    /** The snapshot's instant: the data is as of then. */
    asOf: instantSchema.nullable(),
    expiresAt: instantSchema.nullable(),
    failure: dataExportFailureSchema.nullable(),
    fileName: z.string().nullable(),
    byteSize: z.int().min(0).nullable(),
    rowCounts: z.record(z.string(), z.int().min(0)).nullable(),
  })
  .meta({ id: 'DataExport' });

export type DataExport = z.infer<typeof dataExportSchema>;

export const dataExportListQuerySchema = z
  .object({ before: idSchema.optional() })
  .meta({ id: 'DataExportListQuery' });

/** The history, newest first, with today's allowance (rule 8). */
export const dataExportPageSchema = z
  .object({
    items: z.array(dataExportSchema),
    nextBefore: idSchema.nullable(),
    remainingToday: z.int().min(0).max(dataExportPolicy.dailyLimit),
    nextAllowedAt: instantSchema.nullable(),
  })
  .meta({ id: 'DataExportPage' });

export type DataExportPage = z.infer<typeof dataExportPageSchema>;

/** `POST /api/tenant/data-exports/:id/link` (rule 16): a path holding a random token. */
export const dataExportLinkSchema = z
  .object({ url: z.string().min(1), expiresAt: instantSchema })
  .meta({ id: 'DataExportLink' });

export type DataExportLink = z.infer<typeof dataExportLinkSchema>;

/** The token of a download link: 32 random bytes in base64url (rule 16). */
export const dataExportTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .meta({ id: 'DataExportToken' });
