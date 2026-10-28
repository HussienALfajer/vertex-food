import { Logger } from '@nestjs/common';
import { Browsers, fetchLatestWaWebVersion, makeWASocket } from 'baileys';
import { describeError } from '../core/log/describe-error.js';
import { credentialAuthState } from './baileys-auth-state.js';
import {
  accountPhoneOf,
  disconnectReasonOf,
  incomingOf,
  isIgnoredJid,
  jidOfPhone,
  receiptOf,
  statusCodeOf,
} from './baileys-mapping.js';
import type {
  CredentialStore,
  SessionEvents,
  TransportConnection,
  WhatsAppTransport,
} from './whatsapp-transport.js';

/** Baileys logs JIDs and message content: it gets a logger that writes nothing (ADR 0016). */
type BaileysLogger = NonNullable<Parameters<typeof makeWASocket>[0]['logger']>;

const silent: BaileysLogger = {
  level: 'silent',
  child: () => silent,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** A recipient that has no WhatsApp account: a transport error like any other (rule 15). */
export class NotOnWhatsAppError extends Error {
  override name = 'NotOnWhatsAppError';
}

/**
 * The Baileys transport (ADR 0034, Vertex Shifa's Spike B): the exact pinned v7 version in
 * `package.json`, the `WEB_BROWSER` sub-platform (`Browsers.ubuntu`: Windows was refused from
 * 2026-06-30), history sync and presence off, groups, broadcasts and newsletters ignored. Linked
 * means an open connection with `creds.me` set. Pending credential writes finish before `close` is
 * reported, so the reconnect after a scan's `515` reads the stored link. Never used in tests.
 */
export class BaileysWhatsAppTransport implements WhatsAppTransport {
  private readonly logger = new Logger('Baileys');

  async connect(
    sessionId: string,
    credentials: CredentialStore,
    events: SessionEvents,
  ): Promise<TransportConnection> {
    const { state, saveCreds } = await credentialAuthState(credentials);
    const latest = await fetchLatestWaWebVersion({}).catch(() => undefined);
    this.logger.log(`Session ${sessionId} connects with WhatsApp Web ${latest?.version.join('.')}`);
    let live = true;
    let saving: Promise<void> = Promise.resolve();
    const socket = makeWASocket({
      auth: state,
      ...(latest && { version: latest.version }),
      browser: Browsers.ubuntu('Chrome'),
      logger: silent,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: isIgnoredJid,
      getMessage: async (key) => {
        const text = key.id ? await events.sentText(key.id) : null;
        return text === null ? undefined : { conversation: text };
      },
    });

    socket.ev.on('creds.update', () => {
      saving = saving
        .then(saveCreds)
        .catch((error) =>
          this.logger.warn(`Session ${sessionId} credentials not saved: ${describeError(error)}`),
        );
    });
    socket.ev.on('connection.update', (update) => {
      if (!live) return;
      if (update.qr) events.qr(update.qr);
      if (update.connection === 'open') {
        const phone = accountPhoneOf(state.creds);
        if (phone) events.open({ phone });
      }
      if (update.connection === 'close') {
        live = false;
        const reason = disconnectReasonOf(statusCodeOf(update.lastDisconnect?.error));
        void saving.then(() => events.close(reason));
      }
    });
    socket.ev.on('messages.upsert', async ({ messages }) => {
      for (const message of messages) {
        const incoming = await incomingOf(message, (lid) =>
          socket.signalRepository.lidMapping.getPNForLID(lid),
        );
        if (incoming && live) events.message(incoming);
      }
    });
    socket.ev.on('messages.update', (updates) => {
      for (const update of updates) {
        const receipt = receiptOf(update, new Date());
        if (receipt && live) events.receipt(receipt);
      }
    });

    return {
      sendText: async (to, text) => {
        if (!live) throw new Error('The connection is closed');
        const jid = jidOfPhone(to);
        const [found] = (await socket.onWhatsApp(jid)) ?? [];
        if (!found?.exists) throw new NotOnWhatsAppError('The recipient is not on WhatsApp');
        const sent = await socket.sendMessage(jid, { text });
        if (!sent?.key.id) throw new Error('WhatsApp returned no message id');
        return { messageId: sent.key.id };
      },
      logout: async () => {
        live = false;
        await socket.logout();
        await saving;
      },
      close: async () => {
        live = false;
        await socket.end(undefined);
        await saving;
      },
    };
  }
}
