import {
  type CredentialStore,
  type DisconnectReason,
  type IncomingMessage,
  type Receipt,
  RecipientUnreachableError,
  type SessionEvents,
  type TransportConnection,
  type WhatsAppTransport,
} from './whatsapp-transport.js';

/** The credential key where the fake keeps a linked session's account. */
const ACCOUNT_KEY = 'fake.account';

/** A message the fake accepted; it went nowhere. */
export interface FakeSentMessage {
  sessionId: string;
  messageId: string;
  to: string;
  text: string;
}

interface Live {
  events: SessionEvents;
  credentials: CredentialStore;
  open: boolean;
}

/**
 * A `WhatsAppTransport` that talks to nobody: no network, no WhatsApp account, no log. It behaves
 * like the real one where the gateway depends on it (ADR 0034): events come after `connect`
 * resolves, a new session shows QR codes, a scan stores the account and closes with
 * `restart_required` before the session opens, a second connection to a session replaces the
 * first with `connection_replaced`, a closed connection refuses to send, and a logout forgets the
 * account. Tests and local runs drive the rest (`scan`, `disconnect`, `receive`, `acknowledge`,
 * `retryRequest`, `failNextSends`) and read what was sent from `sent`.
 */
export class FakeWhatsAppTransport implements WhatsAppTransport {
  readonly sent: FakeSentMessage[] = [];
  /** Sessions logged out through `logout`. */
  readonly loggedOut: string[] = [];
  /** Phones with no WhatsApp account: sending to them is refused as unreachable. */
  readonly withoutWhatsApp = new Set<string>();
  private readonly live = new Map<string, Live>();
  private codes = 0;
  private messages = 0;
  private failures = 0;

  /** `messageIds` prefixes the ids it hands out, unique per fake like WhatsApp's are. */
  constructor(private readonly messageIds = 'fake-message') {}

  async connect(
    sessionId: string,
    credentials: CredentialStore,
    events: SessionEvents,
  ): Promise<TransportConnection> {
    const previous = this.live.get(sessionId);
    if (previous) this.drop(sessionId, previous, 'connection_replaced');
    const live: Live = { events, credentials, open: true };
    this.live.set(sessionId, live);
    setTimeout(async () => {
      if (!live.open) return;
      const phone = (await credentials.get([ACCOUNT_KEY])).get(ACCOUNT_KEY);
      if (!live.open) return;
      if (phone === undefined) events.qr(`fake-qr-${++this.codes}`);
      else events.open({ phone });
    }, 0);
    return {
      sendText: async (to, text) => {
        if (!live.open) throw new Error('The connection is closed');
        if (this.withoutWhatsApp.has(to)) {
          throw new RecipientUnreachableError('The recipient is not on WhatsApp');
        }
        if (this.failures > 0) {
          this.failures--;
          throw new Error('The fake refused the message');
        }
        const messageId = `${this.messageIds}-${++this.messages}`;
        this.sent.push({ sessionId, messageId, to, text });
        return { messageId };
      },
      logout: async () => {
        this.loggedOut.push(sessionId);
        live.open = false;
        if (this.live.get(sessionId) === live) this.live.delete(sessionId);
        // WhatsApp unlinked the device; the store may already refuse the write (an unlink).
        await credentials.set({ [ACCOUNT_KEY]: null }).catch(() => {});
      },
      close: async () => {
        live.open = false;
        if (this.live.get(sessionId) === live) this.live.delete(sessionId);
      },
    };
  }

  /** Whether the session has an open connection. */
  isConnected(sessionId: string): boolean {
    return this.live.has(sessionId);
  }

  /** Scans the session's QR code with `phone`'s WhatsApp: links it, then restarts like WhatsApp. */
  async scan(sessionId: string, phone: string): Promise<void> {
    const live = this.connected(sessionId);
    await live.credentials.set({ [ACCOUNT_KEY]: phone });
    this.drop(sessionId, live, 'restart_required');
  }

  /** Closes the session's connection from WhatsApp's side, for `reason`. */
  disconnect(sessionId: string, reason: DisconnectReason): void {
    this.drop(sessionId, this.connected(sessionId), reason);
  }

  /** Delivers an incoming message to the session. */
  receive(sessionId: string, message: IncomingMessage): void {
    this.connected(sessionId).events.message(message);
  }

  /** Delivers a receipt for a message the session sent. */
  acknowledge(sessionId: string, receipt: Receipt): void {
    this.connected(sessionId).events.receipt(receipt);
  }

  /** A recipient device asks the session to resend `messageId`: the text the gateway still has. */
  retryRequest(sessionId: string, messageId: string): Promise<string | null> {
    return this.connected(sessionId).events.sentText(messageId);
  }

  /** The next `count` sends of any session fail, as a transport error. */
  failNextSends(count: number): void {
    this.failures = count;
  }

  private connected(sessionId: string): Live {
    const live = this.live.get(sessionId);
    if (!live) throw new Error(`Session ${sessionId} has no open connection`);
    return live;
  }

  private drop(sessionId: string, live: Live, reason: DisconnectReason): void {
    live.open = false;
    this.live.delete(sessionId);
    live.events.close(reason);
  }
}
