import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = new URL('../src/', import.meta.url);

/** WhatsApp client libraries; only a transport in `src/transport/` may import one (ADR 0034). */
const LIBRARIES = ['baileys', '@whiskeysockets/baileys'];
/** What the rest of the gateway may import from `src/transport/`: the interface and the module. */
const TRANSPORT_SURFACE = ['whatsapp-transport.js', 'transport.module.js'];

function sourceFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(src, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    files.set(entry.split(sep).join('/'), readFileSync(new URL(entry, src), 'utf8'));
  }
  return files;
}

/** Imports of a WhatsApp library or of a concrete transport outside `src/transport/`. */
function violations(files: Map<string, string>): string[] {
  const found: string[] = [];
  for (const [file, source] of files) {
    if (file.startsWith('transport/')) continue;
    for (const [, specifier = ''] of source.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
      const library = LIBRARIES.some(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      );
      const transport = /(^|\/)transport\/([^/]+)$/.exec(specifier)?.[2];
      if (library || (transport && !TRANSPORT_SURFACE.includes(transport))) {
        found.push(`${file} imports ${specifier}`);
      }
    }
  }
  return found;
}

describe('the transport boundary', () => {
  it('keeps every concrete transport and WhatsApp library inside src/transport/', () => {
    const files = sourceFiles();
    expect(files.has('sessions/sessions.service.ts')).toBe(true);
    expect(files.has('transport/baileys-transport.ts')).toBe(true);
    expect(violations(files)).toEqual([]);
  });

  it('catches a session or sending file that reaches past the interface', () => {
    const files = new Map([
      ['transport/baileys-transport.ts', "import { makeWASocket } from 'baileys';"],
      ['sessions/a.ts', "import { FakeWhatsAppTransport } from '../transport/fake-transport.js';"],
      ['sending/b.ts', "import type { proto } from '@whiskeysockets/baileys';"],
      ['incoming/c.ts', "const lib = await import('baileys');"],
      ['sending/d.ts', "import { WHATSAPP_TRANSPORT } from '../transport/whatsapp-transport.js';"],
    ]);
    expect(violations(files)).toEqual([
      'sessions/a.ts imports ../transport/fake-transport.js',
      'sending/b.ts imports @whiskeysockets/baileys',
      'incoming/c.ts imports baileys',
    ]);
  });
});
