import {
  type AuthenticationCreds,
  DisconnectReason as BaileysDisconnect,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  jidDecode,
  normalizeMessageContent,
  proto,
  toNumber,
  type WAMessage,
  type WAMessageUpdate,
} from 'baileys';
import type { DisconnectReason, IncomingMessage, Receipt } from './whatsapp-transport.js';

// The translation between Baileys' payloads and the transport interface (ADR 0034, Vertex
// Shifa's Spike B), kept pure so it is tested with recorded synthetic payloads and never a live
// connection.

/** Baileys' close codes to the library-neutral reasons: 515, 401, 403, 440, anything else lost. */
export function disconnectReasonOf(statusCode: number | undefined): DisconnectReason {
  switch (statusCode) {
    case BaileysDisconnect.restartRequired:
      return 'restart_required';
    case BaileysDisconnect.loggedOut:
      return 'logged_out';
    case BaileysDisconnect.forbidden:
      return 'forbidden';
    case BaileysDisconnect.connectionReplaced:
      return 'connection_replaced';
    default:
      return 'connection_lost';
  }
}

/** The status code of a close event's error (a Boom error from Baileys), if it has one. */
export function statusCodeOf(error: unknown): number | undefined {
  const code = (error as { output?: { statusCode?: unknown } } | undefined)?.output?.statusCode;
  return typeof code === 'number' ? code : undefined;
}

/** The E.164 phone of a phone-number JID (`<digits>[:device]@s.whatsapp.net`); null otherwise. */
export function phoneOfJid(jid: string | null | undefined): string | null {
  const decoded = jid ? jidDecode(jid) : undefined;
  if (decoded?.server !== 's.whatsapp.net' || !/^[0-9]{8,15}$/.test(decoded.user)) return null;
  return `+${decoded.user}`;
}

/** The JID WhatsApp addresses an E.164 phone by. */
export function jidOfPhone(phone: string): string {
  return `${phone.replace(/^\+/, '')}@s.whatsapp.net`;
}

/** The linked account's phone: set only once the scan completed (`creds.me`, not `registered`). */
export function accountPhoneOf(creds: Pick<AuthenticationCreds, 'me'>): string | null {
  return phoneOfJid(creds.me?.id);
}

/** Chats the gateway never looks at: groups, broadcasts (status included) and newsletters. */
export function isIgnoredJid(jid: string): boolean {
  return Boolean(isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid));
}

const receiptStatuses = new Map<number, Receipt['status']>([
  [proto.WebMessageInfo.Status.ERROR, 'failed'],
  [proto.WebMessageInfo.Status.SERVER_ACK, 'sent'],
  [proto.WebMessageInfo.Status.DELIVERY_ACK, 'delivered'],
  [proto.WebMessageInfo.Status.READ, 'read'],
  [proto.WebMessageInfo.Status.PLAYED, 'read'],
]);

/** A status update of a message this session sent, as a receipt; undefined for anything else. */
export function receiptOf(update: WAMessageUpdate, now: Date): Receipt | undefined {
  const status = update.update.status;
  if (!update.key.fromMe || !update.key.id || typeof status !== 'number') return undefined;
  if (update.key.remoteJid && isIgnoredJid(update.key.remoteJid)) return undefined;
  const mapped = receiptStatuses.get(status);
  return mapped && { messageId: update.key.id, status: mapped, at: now };
}

/** The text of a message's content, plain or extended; undefined for media and the rest. */
function textOf(message: WAMessage['message']): string | undefined {
  const content = normalizeMessageContent(message);
  const text = content?.conversation ?? content?.extendedTextMessage?.text;
  return typeof text === 'string' && text.length > 0 ? text : undefined;
}

/**
 * An incoming 1:1 text message, with the sender's phone resolved: from the JID, its alternate JID,
 * or, for a LID-addressed chat, Baileys' LID mapping (`resolveLid`). Undefined for the session's
 * own messages, groups, broadcasts, newsletters and anything without text.
 */
export async function incomingOf(
  message: WAMessage,
  resolveLid: (lid: string) => Promise<string | null>,
): Promise<IncomingMessage | undefined> {
  const { key } = message;
  if (key.fromMe || !key.id || !key.remoteJid || isIgnoredJid(key.remoteJid)) return undefined;
  const text = textOf(message.message);
  if (text === undefined) return undefined;
  let from = phoneOfJid(key.remoteJid) ?? phoneOfJid(key.remoteJidAlt);
  if (from === null && isLidUser(key.remoteJid)) {
    from = phoneOfJid(await resolveLid(key.remoteJid).catch(() => null));
  }
  const seconds = message.messageTimestamp == null ? 0 : toNumber(message.messageTimestamp);
  return { id: key.id, from, text, sentAt: new Date(seconds * 1000) };
}
