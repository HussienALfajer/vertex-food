import type { DisconnectReason } from '@vertex-food/contracts';

export type { DisconnectReason };

/**
 * The WhatsApp transport (ADR 0012, ADR 0034), copied from Vertex Shifa's gateway and adapted: the
 * only part of the gateway that knows the library behind WhatsApp. Sessions and sending use this
 * interface and the `WHATSAPP_TRANSPORT` token, never a concrete transport, so Baileys can be
 * replaced by an official transport. Phones are E.164 (`+9639…`); no transport logs a message
 * body, a phone or a QR code (ADR 0016).
 */
export interface WhatsAppTransport {
  /**
   * Opens one session's connection. A session with stored credentials connects and emits `open`;
   * a new one emits `qr` until the code is scanned. Exactly one live connection per session: the
   * caller holds the session's lease before connecting (spec S03 rule 1).
   */
  connect(
    sessionId: string,
    credentials: CredentialStore,
    events: SessionEvents,
  ): Promise<TransportConnection>;
}

/** One open connection of a session. */
export interface TransportConnection {
  /** Sends a text message; resolves once the transport has accepted it, with its message id. */
  sendText(to: string, text: string): Promise<{ messageId: string }>;
  /** Unlinks this device from the account (the phone's linked devices), then closes. */
  logout(): Promise<void>;
  /** Closes the connection without unlinking the session; emits no `close` event. */
  close(): Promise<void>;
}

/**
 * Where a transport keeps a session's credentials and protocol state, as opaque values by key.
 * The caller supplies it: sealed in the database (`whatsapp_session_credentials`), in memory in
 * unit tests. A write of several keys is applied together or not at all (spec S03 rule 3).
 */
export interface CredentialStore {
  /** The stored values of these keys; a missing key is absent from the map. */
  get(keys: readonly string[]): Promise<Map<string, string>>;
  /** Writes each entry; `null` removes the key. */
  set(entries: Record<string, string | null>): Promise<void>;
}

/** What a connection reports. Handlers return nothing and must not throw. */
export interface SessionEvents {
  /** A code to show for linking; renewed until it is scanned. */
  qr(code: string): void;
  /** Linked and connected as `phone` (an open connection with the account set: `creds.me`). */
  open(account: { phone: string }): void;
  /** The connection closed; the session decides what to do from the reason. */
  close(reason: DisconnectReason): void;
  /** An incoming 1:1 text message. */
  message(message: IncomingMessage): void;
  /** A receipt for a message this session sent; receipts may repeat or arrive out of order. */
  receipt(receipt: Receipt): void;
  /**
   * Not an event: the text this session sent as `messageId`, for a recipient device's retry
   * request, while the caller still keeps it (one hour, sealed, ADR 0034); null afterwards.
   */
  sentText(messageId: string): Promise<string | null>;
}

/**
 * An incoming 1:1 text message. Groups, broadcasts, newsletters and status never reach the
 * gateway. The transport resolves the sender's phone before reporting it (LID addressing);
 * `from` is null when it cannot. Messages received while the gateway was down arrive on reconnect
 * like live ones, and one message may be reported twice: the receiver de-duplicates by `id`.
 */
export interface IncomingMessage {
  id: string;
  from: string | null;
  text: string;
  sentAt: Date;
}

/** A receipt for a sent message: `sent` is the server's acknowledgement. */
export interface Receipt {
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  at: Date;
}

/**
 * `sendText`'s refusal when the recipient's phone has no WhatsApp account: a problem with the
 * person's phone, not with the number, so it is never retried or counted against the number.
 */
export class RecipientUnreachableError extends Error {
  override name = 'RecipientUnreachableError';
}

/** Injection token of the process's `WhatsAppTransport`. */
export const WHATSAPP_TRANSPORT = Symbol('WhatsAppTransport');
