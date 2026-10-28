import {
  isWhatsAppSessionHealthy,
  type PlatformWhatsAppSession,
  type WhatsAppPauseReason,
  type WhatsAppSessionEvent,
  type WhatsAppSessionEventType,
  type WhatsAppSessionState,
  whatsappDailyCap,
  whatsappFirstContactCap,
  whatsappPolicy,
  whatsappWarmUpDay,
} from '@vertex-food/contracts';
import type { whatsappSessionEvents, whatsappSessions } from '@vertex-food/db';

export type WhatsAppSessionRow = typeof whatsappSessions.$inferSelect;
export type WhatsAppSessionEventRow = typeof whatsappSessionEvents.$inferSelect;

/** A number's sends over the rolling windows of rules 8–9, counted from its `linked_at`. */
export type WhatsAppSessionUsage = {
  sentLastHour: number;
  sentLast24h: number;
  firstContactsLast24h: number;
};

export const NO_USAGE: WhatsAppSessionUsage = {
  sentLastHour: 0,
  sentLast24h: 0,
  firstContactsLast24h: 0,
};

const instant = (value: Date | null) => value?.toISOString() ?? null;

/** A session as the console shows it; `now` is the database's clock (rule 11). */
export function toPlatformWhatsAppSession(
  row: WhatsAppSessionRow,
  usage: WhatsAppSessionUsage,
  now: Date,
): PlatformWhatsAppSession {
  const state = row.state as WhatsAppSessionState;
  const warmUpDay = whatsappWarmUpDay(row.linkedAt, now);
  const dailyCap = whatsappDailyCap(warmUpDay);
  return {
    id: row.id,
    label: row.label,
    phone: row.phone,
    state,
    pausedAt: instant(row.pausedAt),
    pauseReason: row.pauseReason as WhatsAppPauseReason | null,
    linkedAt: instant(row.linkedAt),
    warmUpDay,
    sentLast24h: usage.sentLast24h,
    dailyCap,
    firstContactsLast24h: usage.firstContactsLast24h,
    firstContactCap: whatsappFirstContactCap(dailyCap),
    sentLastHour: usage.sentLastHour,
    hourlyCap: whatsappPolicy.maxPerHour,
    lastConnectedAt: instant(row.lastConnectedAt),
    leaseHeld: row.leaseExpiresAt !== null && row.leaseExpiresAt > now,
    healthy: isWhatsAppSessionHealthy({ ...row, state }, now),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toWhatsAppSessionEvent(
  row: WhatsAppSessionEventRow,
  names: Map<string, string>,
): WhatsAppSessionEvent {
  return {
    id: row.id,
    type: row.type as WhatsAppSessionEventType,
    reason: row.reason,
    platformUserName: row.platformUserId ? (names.get(row.platformUserId) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  };
}
