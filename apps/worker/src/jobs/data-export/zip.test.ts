import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { unzip } from '../../../test/unzip.js';
import { ZipWriter } from './zip.js';

async function* pieces(...parts: Buffer[]): AsyncIterable<Buffer> {
  yield* parts;
}

describe('ZipWriter', () => {
  it('streams entries that an independent reader opens, with their hashes and Damascus times', async () => {
    const written: Buffer[] = [];
    // 13:05 on 29 October 2026 in Damascus (UTC+3).
    const zip = new ZipWriter(async (bytes) => {
      written.push(Buffer.from(bytes));
    }, new Date('2026-10-29T10:05:00Z'));
    const big = randomBytes(300_000);
    const arabic = Buffer.from('اسم,هاتف\r\nأحمد,+963\r\n', 'utf8');
    const hashes = [
      await zip.add('big.bin', pieces(big.subarray(0, 100_000), big.subarray(100_000))),
      await zip.add('ملف.csv', pieces(arabic)),
      await zip.add('empty.csv', pieces()),
    ];
    await zip.finish();

    const entries = unzip(Buffer.concat(written));
    expect(entries.map((entry) => entry.path)).toEqual(['big.bin', 'ملف.csv', 'empty.csv']);
    expect(entries[0]?.bytes.equals(big)).toBe(true);
    expect(entries[1]?.bytes.toString('utf8')).toBe(arabic.toString('utf8'));
    expect(entries[2]?.bytes.length).toBe(0);
    const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    expect(hashes).toEqual([sha(big), sha(arabic), sha(Buffer.alloc(0))]);
    expect(entries[0]?.modified).toEqual({
      date: ((2026 - 1980) << 9) | (10 << 5) | 29,
      time: (13 << 11) | (5 << 5),
    });
  });

  it('holds the reads back while the store is slow', async () => {
    let inFlight = 0;
    let most = 0;
    const zip = new ZipWriter(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    }, new Date());
    await zip.add('random.bin', pieces(randomBytes(200_000), randomBytes(200_000)));
    await zip.finish();
    expect(most).toBe(1);
  });
});
