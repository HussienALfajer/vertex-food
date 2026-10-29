import { readFile } from 'node:fs/promises';
import {
  createServer as createPlainServer,
  type IncomingMessage,
  type Server as PlainServer,
  type ServerResponse,
} from 'node:http';
import { Agent, createServer, request, type Server } from 'node:https';
import { extname } from 'node:path';
import { checkServerIdentity, type PeerCertificate, type TLSSocket } from 'node:tls';
import {
  DomainError,
  errorStatus,
  type HubCommand,
  type HubCommandAnswer,
  type HubHello,
  hubCommandAnswerSchema,
  hubCommandSchema,
  hubHelloSchema,
  hubPairRequestSchema,
  hubSessionRequestSchema,
} from '@vertex-food/contracts';
import {
  type BranchHub,
  type CommandSource,
  forwardAnswerSchema,
  forwardRequestSchema,
  type HubClientTransport,
  heartbeatAnswerSchema,
  heartbeatRequestSchema,
  journalAnswerSchema,
  journalRequestSchema,
  mirrorAnswerSchema,
  mirrorRequestSchema,
  type PairingRecord,
  type PeerLink,
  type PeerTransport,
  peerStateAnswerSchema,
  peerStateRequestSchema,
} from '@vertex-food/sync';
import type { ZodType, z } from 'zod';
import { contentSecurityPolicy, resolvePageFile } from './app-protocol.js';

// The branch hub's LAN server and its clients (spec S04 rules 21–37, ADR 0022, 0035): HTTPS with
// the PC certificate of `pc-certificate.ts`, issued by the branch CA, on two ports. Hub clients
// (phones and screens) use 7443 and authenticate with their pairing token and PIN session; the
// port never asks for a client certificate, which would make a phone's browser offer a
// certificate picker. PCs use 7444, mutual TLS only: the handshake fails without a certificate of
// the branch CA, and the certificate must name an active PC of the branch (`/hub/*` for client
// PCs, `/peer/*` only for the other hub-capable PC). A revoked PC is refused, and its or a revoked
// pairing's live stream closed, as soon as the synced device list or the pairing shows it (rules
// 34, 42). Nothing here logs a request: the pairing QR's fragment, tokens and command payloads
// never reach a log (ADR 0016).

/** The PC's TLS material, PEM: its key and certificate, and the branch CA it trusts. */
export type HubTls = { key: string; cert: string; ca: string };

/** The PCs' port: mutual TLS with the branch CA's certificates only. */
export const HUB_PC_PORT = 7444;

/** Hub API bodies are small; peer pages carry up to 500 journal entries. */
const HUB_BODY_BYTES = 256 * 1024;
const PEER_BODY_BYTES = 16 * 1024 * 1024;
/** A comment on the live stream now and then keeps idle connections open through routers. */
const LIVE_KEEPALIVE_MS = 15_000;
/** Changes that arrive together are sent as one snapshot. */
const LIVE_COALESCE_MS = 50;

const PAGE_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** The device id a PC certificate names (`CN=<device id>`, issued by the API). */
function deviceIdOf(certificate: PeerCertificate | undefined): string | null {
  const cn = certificate?.subject?.CN;
  return typeof cn === 'string' && cn.length > 0 ? cn : null;
}

/** An IPv4 client address without the IPv6-mapped prefix. */
function remoteAddress(req: IncomingMessage): string {
  return (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
}

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'VALIDATION_FAILED'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'VALIDATION_FAILED'));
      }
    });
    req.on('error', reject);
  });
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_FAILED');
  return parsed.data;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

/** A refusal as the API answers it: the code and an English message, never the request's data. */
function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (error instanceof DomainError) {
    sendJson(res, errorStatus[error.code], {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }
  if (error instanceof HttpError) {
    sendJson(res, error.status, { code: error.code, message: error.code });
    return;
  }
  sendJson(res, 500, { code: 'INTERNAL_ERROR', message: 'Internal error' });
}

export type HubServerDeps = {
  /** The PC's hub, or null while it has none (a client PC, or before its first sync). */
  hub: () => BranchHub | null;
  /** An active PC of the branch (synced `devices`): a revoked one's certificate is refused. */
  isActivePc: (deviceId: string) => boolean;
  /** The other hub-capable PC of the branch, the only one `/peer/*` answers. */
  isPeer: (deviceId: string) => boolean;
  /** `https://<address>:<port>` of both hub-capable PCs: a page loaded from one calls the other. */
  peerOrigins: () => readonly string[];
  /** The branch CA certificate, served on the plain-HTTP port while pairing is open (rule 37). */
  caCertificate: () => string | null;
  /** The hub client pages' build (`dist/hub-clients/`), or null when it is not built. */
  pagesDirectory: string | null;
};

/** The phones' HTTPS port (7443), the PCs' (7444) and the CA download's (7080). */
export type HubServerAddress = { host: string; port: number; pcPort: number; caPort: number };

/** Who opened a live stream: checked again before every snapshot (rules 34, 42). */
type LiveStream = { pairingId: string | null; deviceId: string | null };

type PeerRoute = {
  schema: ZodType<{ from: string }>;
  handle: (hub: BranchHub, request: never) => Promise<unknown>;
};

const peerRoutes: Readonly<Record<string, PeerRoute>> = {
  '/peer/state': {
    schema: peerStateRequestSchema,
    handle: (hub, r: z.infer<typeof peerStateRequestSchema>) => hub.peerState(r),
  },
  '/peer/heartbeat': {
    schema: heartbeatRequestSchema,
    handle: (hub, r: z.infer<typeof heartbeatRequestSchema>) => hub.peerHeartbeat(r),
  },
  '/peer/mirror': {
    schema: mirrorRequestSchema,
    handle: (hub, r: z.infer<typeof mirrorRequestSchema>) => hub.peerMirror(r),
  },
  '/peer/journal': {
    schema: journalRequestSchema,
    handle: (hub, r: z.infer<typeof journalRequestSchema>) => hub.peerJournal(r),
  },
  '/peer/forward': {
    schema: forwardRequestSchema,
    handle: (hub, r: z.infer<typeof forwardRequestSchema>) => hub.peerForward(r),
  },
};

/**
 * The hub's HTTPS servers, for phones on 7443 and for PCs on 7444, and the plain-HTTP port 7080
 * that answers only `/ca.crt`, only while pairing is open (rule 37). Requests are served whichever
 * role the PC holds: a standby answers its peer and tells clients it is not the hub.
 */
export class HubLanServer {
  private pages: Server | null = null;
  private pcs: Server | null = null;
  private plain: PlainServer | null = null;
  private readonly live = new Map<ServerResponse, LiveStream>();
  private detachLive: (() => void) | null = null;
  private liveTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: HubServerDeps) {}

  async start(tls: HubTls, address: HubServerAddress): Promise<void> {
    const pages = createServer({ ...tls, minVersion: 'TLSv1.2' }, (req, res) => {
      void this.handle(req, res, false);
    });
    const pcs = createServer(
      { ...tls, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      (req, res) => void this.handle(req, res, true),
    );
    const plain = createPlainServer((req, res) => this.handleCa(req, res));
    const started: (Server | PlainServer)[] = [];
    try {
      for (const [server, port] of [
        [pages, address.port],
        [pcs, address.pcPort],
        [plain, address.caPort],
      ] as const) {
        await listen(server, address.host, port);
        started.push(server);
      }
    } catch (error) {
      await Promise.all(started.map(close));
      throw error;
    }
    this.pages = pages;
    this.pcs = pcs;
    this.plain = plain;
    this.keepAlive = setInterval(() => {
      void this.recheckLive().then(() => {
        for (const res of this.live.keys()) res.write(': keepalive\n\n');
      });
    }, LIVE_KEEPALIVE_MS);
  }

  /** A new certificate (an address changed, a renewal): new connections use it. */
  updateTls(tls: HubTls): void {
    this.pages?.setSecureContext({ ...tls });
    this.pcs?.setSecureContext({ ...tls });
  }

  async stop(): Promise<void> {
    this.closeLiveStreams();
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    const servers = [this.pages, this.pcs, this.plain];
    this.pages = null;
    this.pcs = null;
    this.plain = null;
    await Promise.all(servers.map((server) => (server ? close(server) : undefined)));
  }

  /** The hub instance changed (a restart with new peers): clients connect again. */
  closeLiveStreams(): void {
    this.detachLive?.();
    this.detachLive = null;
    for (const res of this.live.keys()) res.end();
    this.live.clear();
    this.deps.hub()?.setLiveClients(0);
  }

  private handleCa(req: IncomingMessage, res: ServerResponse): void {
    const ca = this.deps.caCertificate();
    const path = (req.url ?? '').split('?')[0];
    if (req.method !== 'GET' || path !== '/ca.crt' || !ca || !this.deps.hub()?.pairing.isOpen()) {
      res.writeHead(404, { 'content-length': 0 });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/x-x509-ca-cert',
      'content-disposition': 'attachment; filename="vertex-food-branch-ca.crt"',
      'cache-control': 'no-store',
    });
    res.end(ca);
  }

  /**
   * The device id of an active PC that presented a certificate of the branch CA, else null. Only
   * the PCs' port asks for one.
   */
  private pcOf(req: IncomingMessage): string | null {
    const socket = req.socket as TLSSocket;
    if (!socket.authorized) return null;
    const deviceId = deviceIdOf(socket.getPeerCertificate());
    return deviceId && this.deps.isActivePc(deviceId) ? deviceId : null;
  }

  private cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (!origin || !this.deps.peerOrigins().includes(origin)) return;
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-hub-session');
    res.setHeader('access-control-allow-methods', 'GET, POST, DELETE');
  }

  private async handle(req: IncomingMessage, res: ServerResponse, pcPort: boolean) {
    try {
      const path = new URL(req.url ?? '/', 'https://hub.invalid').pathname;
      if (pcPort) {
        if (path.startsWith('/peer/')) return await this.peer(req, res, path);
        if (path.startsWith('/hub/')) return await this.pcApi(req, res, path);
        throw new HttpError(404, 'NOT_FOUND');
      }
      this.cors(req, res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'content-length': 0 });
        res.end();
        return;
      }
      if (path.startsWith('/hub/')) return await this.hubApi(req, res, path);
      return await this.page(req, res, path);
    } catch (error) {
      sendError(res, error);
    }
  }

  private requireHub(): BranchHub {
    const hub = this.deps.hub();
    if (!hub) throw new DomainError('NOT_HUB', 'This PC is not the hub');
    return hub;
  }

  private async peer(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const route = peerRoutes[path];
    if (!route || req.method !== 'POST') throw new HttpError(404, 'NOT_FOUND');
    const pc = this.pcOf(req);
    if (!pc || !this.deps.isPeer(pc)) throw new HttpError(403, 'FORBIDDEN');
    const body = parse(route.schema, await readBody(req, PEER_BODY_BYTES));
    // A peer speaks only for itself.
    if (body.from !== pc) throw new HttpError(403, 'FORBIDDEN');
    sendJson(res, 200, await route.handle(this.requireHub(), body as never));
  }

  private async pairingOf(req: IncomingMessage, hub: BranchHub): Promise<PairingRecord | null> {
    const token = bearer(req);
    return token ? hub.pairing.authenticate(token) : null;
  }

  /** `/hub/*` for a client PC, on the PCs' port (rule 30): hello, its commands, the live state. */
  private async pcApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const pc = this.pcOf(req);
    if (!pc) throw new HttpError(403, 'FORBIDDEN');
    const hub = this.requireHub();
    const source: CommandSource = { kind: 'pc', deviceId: pc };
    if (await this.common(req, res, path, hub, source, { pairingId: null, deviceId: pc })) return;
    throw new HttpError(404, 'NOT_FOUND');
  }

  /** The routes a paired client and a client PC share; false when `path` is not one of them. */
  private async common(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    hub: BranchHub,
    source: CommandSource | (() => Promise<CommandSource>),
    stream: LiveStream,
  ): Promise<boolean> {
    switch (`${req.method} ${path}`) {
      case 'GET /hub/hello':
        sendJson(res, 200, hub.hello());
        return true;
      case 'GET /hub/live':
        this.openLive(req, res, hub, stream);
        return true;
      case 'POST /hub/commands': {
        const command = parse(hubCommandSchema, await readBody(req, HUB_BODY_BYTES));
        const from = typeof source === 'function' ? await source() : source;
        const answer = await hub.submit(command, from);
        sendJson(res, answer.status === 'not_hub' ? 409 : 200, answer);
        return true;
      }
    }
    return false;
  }

  private async hubApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const hub = this.requireHub();
    const route = `${req.method} ${path}`;
    if (route === 'POST /hub/pair') {
      const { code } = parse(hubPairRequestSchema, await readBody(req, HUB_BODY_BYTES));
      sendJson(res, 200, await hub.pairing.pair(code, remoteAddress(req)));
      return;
    }
    const pairing = await this.pairingOf(req, hub);
    if (!pairing) throw new HttpError(401, 'UNAUTHENTICATED');
    const source = () => hub.sourceOfPairing(pairing, sessionToken(req));
    const stream = { pairingId: pairing.id, deviceId: null };
    if (await this.common(req, res, path, hub, source, stream)) return;
    // Member sessions belong to personal pairings only (rule 35).
    switch (route) {
      case 'GET /hub/members':
        sendJson(res, 200, hub.pairing.membersFor(pairing));
        return;
      case 'POST /hub/sessions': {
        const input = parse(hubSessionRequestSchema, await readBody(req, HUB_BODY_BYTES));
        sendJson(res, 200, await hub.pairing.startSession(pairing, input));
        return;
      }
      case 'DELETE /hub/sessions/current': {
        const token = sessionToken(req);
        if (token) await hub.pairing.endSession(pairing, token);
        res.writeHead(204, { 'content-length': 0 });
        res.end();
        return;
      }
    }
    throw new HttpError(404, 'NOT_FOUND');
  }

  /** Rule 32: the full snapshot over server-sent events, again after every change. */
  private openLive(req: IncomingMessage, res: ServerResponse, hub: BranchHub, stream: LiveStream) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    this.live.set(res, stream);
    if (!this.detachLive) this.detachLive = hub.onChange(() => this.scheduleLive());
    this.countLive(hub);
    void this.sendLive([res], hub);
    req.on('close', () => {
      this.live.delete(res);
      this.countLive(hub);
    });
  }

  /** Hub clients on the live stream, for the equal-epoch tie-break (rule 28); PCs do not count. */
  private countLive(hub: BranchHub): void {
    let clients = 0;
    for (const { pairingId } of this.live.values()) if (pairingId) clients += 1;
    hub.setLiveClients(clients);
  }

  /**
   * Closes the streams of a pairing revoked or expired, or of a PC revoked, since they opened
   * (rules 34, 42): before every snapshot, at every keepalive, and when the runtime reads the
   * synced device list again.
   */
  async recheckLive(): Promise<void> {
    const hub = this.deps.hub();
    if (!hub || this.live.size === 0) return;
    const pairings = new Set((await hub.pairing.list()).map((pairing) => pairing.id));
    let closed = false;
    for (const [res, stream] of [...this.live]) {
      const allowed = stream.pairingId
        ? pairings.has(stream.pairingId)
        : stream.deviceId !== null && this.deps.isActivePc(stream.deviceId);
      if (allowed) continue;
      this.live.delete(res);
      res.end();
      closed = true;
    }
    if (closed) this.countLive(hub);
  }

  private scheduleLive(): void {
    if (this.liveTimer) return;
    this.liveTimer = setTimeout(() => {
      this.liveTimer = null;
      const hub = this.deps.hub();
      if (hub) void this.sendLive([...this.live.keys()], hub);
    }, LIVE_COALESCE_MS);
  }

  private async sendLive(streams: ServerResponse[], hub: BranchHub): Promise<void> {
    if (streams.length === 0) return;
    let text: string;
    try {
      await this.recheckLive();
      text = `data: ${JSON.stringify(await hub.liveSnapshot())}\n\n`;
    } catch {
      return;
    }
    for (const res of streams) if (this.live.has(res)) res.write(text);
  }

  /** The hub client pages (screens 6–9), with the renderer's policy and the peers' origins. */
  private async page(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const directory = this.deps.pagesDirectory;
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !directory) {
      throw new HttpError(404, 'NOT_FOUND');
    }
    const file = resolvePageFile(directory, path);
    if (!file) throw new HttpError(404, 'NOT_FOUND');
    const content = await readFile(file).catch(() => null);
    if (!content) throw new HttpError(404, 'NOT_FOUND');
    res.writeHead(200, {
      'content-type': PAGE_TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': content.length,
      'content-security-policy': contentSecurityPolicy(this.deps.peerOrigins()),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  }
}

function sessionToken(req: IncomingMessage): string | null {
  const header = req.headers['x-hub-session'];
  return typeof header === 'string' && header.length > 0 ? header : null;
}

function listen(server: Server | PlainServer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server: Server | PlainServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

// --- Clients of the LAN server -------------------------------------------------------------------

class Unreachable extends Error {
  constructor() {
    super('The PC did not answer');
  }
}

/** One HTTPS call with mutual TLS, refused unless the answering PC is one of `expected`. */
function lanCall(input: {
  agent: Agent;
  tls: HubTls;
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
  timeoutMs: number;
  expected: (deviceId: string) => boolean;
}): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const data = input.body === undefined ? undefined : JSON.stringify(input.body);
    const req = request(
      input.url,
      {
        method: input.method,
        agent: input.agent,
        ...input.tls,
        // The address must be in the certificate, and the certificate must name a PC we expect.
        checkServerIdentity: (host, certificate) => {
          const error = checkServerIdentity(host, certificate);
          if (error) return error;
          const deviceId = deviceIdOf(certificate);
          return deviceId && input.expected(deviceId)
            ? undefined
            : new Error('The certificate names another PC');
        },
        headers: data
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          clearTimeout(timer);
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
          } catch {
            reject(new Unreachable());
          }
        });
        res.on('error', () => reject(new Unreachable()));
      },
    );
    const timer = setTimeout(() => req.destroy(new Unreachable()), input.timeoutMs);
    req.on('error', () => {
      clearTimeout(timer);
      reject(new Unreachable());
    });
    req.end(data);
  });
}

export type LanOptions = {
  /** The PC's TLS material; null until its certificate arrived. */
  tls: () => HubTls | null;
  /** The PCs' port every hub-capable PC listens on (7444; tests use another). */
  port: number;
};

function lanAgent(): Agent {
  return new Agent({ keepAlive: true, maxSockets: 8 });
}

/**
 * The hub's peer transport (`PeerTransport`): `/peer/*` of the other hub-capable PC over mutual
 * TLS, at the addresses of its certificate. A PC with two networks is tried at the address that
 * answered last, then at the next one.
 */
export function lanPeers(
  options: LanOptions & { addressesOf: (deviceId: string) => readonly string[] },
): PeerTransport {
  const agent = lanAgent();
  const preferred = new Map<string, string>();
  return (deviceId) => {
    const call = async <T>(path: string, schema: ZodType<T>, body: unknown, timeoutMs: number) => {
      const tls = options.tls();
      const addresses = options.addressesOf(deviceId);
      const address = preferred.get(deviceId) ?? addresses[0];
      if (!tls || !address) throw new Unreachable();
      try {
        const answer = await lanCall({
          agent,
          tls,
          url: `https://${address}:${options.port}${path}`,
          method: 'POST',
          body,
          timeoutMs,
          expected: (id) => id === deviceId,
        });
        if (answer.status !== 200) throw new Unreachable();
        preferred.set(deviceId, address);
        return schema.parse(answer.body);
      } catch (error) {
        const next = addresses[(addresses.indexOf(address) + 1) % addresses.length];
        if (next) preferred.set(deviceId, next);
        throw error;
      }
    };
    const link: PeerLink = {
      state: (r, t) => call('/peer/state', peerStateAnswerSchema, r, t),
      heartbeat: (r, t) => call('/peer/heartbeat', heartbeatAnswerSchema, r, t),
      mirror: (r, t) => call('/peer/mirror', mirrorAnswerSchema, r, t),
      journal: (r, t) => call('/peer/journal', journalAnswerSchema, r, t),
      forward: (r, t) => call('/peer/forward', forwardAnswerSchema, r, t),
    };
    return link;
  };
}

/**
 * A PC's own transport to the hub (`HubClientTransport`, rules 30, 31): `/hub/*` over mutual TLS
 * to a hub-capable PC of the branch, or straight to this PC's own hub when the address is its own.
 */
export function lanHubClient(
  options: LanOptions & {
    deviceId: string;
    ownAddresses: () => readonly string[];
    ownHub: () => BranchHub | null;
    /** A hub-capable PC of the branch: only such a certificate is believed. */
    isHubPc: (deviceId: string) => boolean;
  },
): HubClientTransport {
  const agent = lanAgent();
  const own = (address: string) => {
    const hub = options.ownHub();
    return hub && options.ownAddresses().includes(address) ? hub : null;
  };
  return {
    async hello(address, timeoutMs): Promise<HubHello> {
      const hub = own(address);
      if (hub) return hub.hello();
      const tls = options.tls();
      if (!tls) throw new Unreachable();
      const answer = await lanCall({
        agent,
        tls,
        url: `https://${address}:${options.port}/hub/hello`,
        method: 'GET',
        timeoutMs,
        expected: options.isHubPc,
      });
      if (answer.status !== 200) throw new Unreachable();
      return hubHelloSchema.parse(answer.body);
    },
    async command(address, command: HubCommand, timeoutMs): Promise<HubCommandAnswer> {
      const hub = own(address);
      if (hub) return hub.submit(command, { kind: 'pc', deviceId: options.deviceId });
      const tls = options.tls();
      if (!tls) throw new Unreachable();
      const answer = await lanCall({
        agent,
        tls,
        url: `https://${address}:${options.port}/hub/commands`,
        method: 'POST',
        body: command,
        timeoutMs,
        expected: options.isHubPc,
      });
      if (answer.status !== 200 && answer.status !== 409) throw new Unreachable();
      return hubCommandAnswerSchema.parse(answer.body);
    },
  };
}
