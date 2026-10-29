import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { crc32, createDeflateRaw } from 'node:zlib';
import { businessWallClock } from '@vertex-food/contracts';

/** The largest entry or archive a ZIP without its 64-bit extension describes. */
const ZIP32_MAX = 0xffff_ffff;

/** An entry or the archive passed what a 32-bit ZIP holds. */
export class ZipTooLargeError extends Error {
  constructor() {
    super('The ZIP passed 4 GiB');
  }
}

type CentralEntry = {
  name: Buffer;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
};

/** Bit 3: sizes and CRC follow the data; bit 11: names are UTF-8. */
const FLAGS = 0x0808;
const DEFLATE = 8;
const VERSION = 20;

/**
 * A ZIP archive (Deflate) written as a stream (spec S06 rule 10): each entry's content is read,
 * compressed and handed to `out` piece by piece, its CRC and sizes in a data descriptor after it,
 * so no entry and no archive is ever held whole in memory. `out` is awaited, so a slow store holds
 * the reads back. Every entry is dated `modified` on the Damascus clock, as the files' times read.
 */
export class ZipWriter {
  private offset = 0;
  private readonly entries: CentralEntry[] = [];
  private readonly time: number;
  private readonly date: number;

  constructor(
    private readonly out: (bytes: Buffer) => Promise<void>,
    modified: Date,
  ) {
    const { date, minutes } = businessWallClock(modified);
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];
    this.date = ((year - 1980) << 9) | (month << 5) | day;
    this.time = (Math.floor(minutes / 60) << 11) | ((minutes % 60) << 5);
  }

  /** Adds one entry; answers its content's SHA-256 in hex. */
  async add(path: string, content: AsyncIterable<Buffer>): Promise<string> {
    const name = Buffer.from(path, 'utf8');
    const offset = this.offset;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(FLAGS, 6);
    header.writeUInt16LE(DEFLATE, 8);
    header.writeUInt16LE(this.time, 10);
    header.writeUInt16LE(this.date, 12);
    // CRC and sizes (14–25) stay zero: the data descriptor holds them.
    header.writeUInt16LE(name.length, 26);
    await this.write(Buffer.concat([header, name]));

    const hash = createHash('sha256');
    let crc = 0;
    let size = 0;
    let compressed = 0;
    async function* read() {
      for await (const piece of content) {
        size += piece.length;
        if (size > ZIP32_MAX) throw new ZipTooLargeError();
        crc = crc32(piece, crc);
        hash.update(piece);
        yield piece;
      }
    }
    await pipeline(read, createDeflateRaw(), async (deflated: AsyncIterable<Buffer>) => {
      for await (const piece of deflated) {
        compressed += piece.length;
        await this.write(piece);
      }
    });

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(compressed, 8);
    descriptor.writeUInt32LE(size, 12);
    await this.write(descriptor);
    this.entries.push({ name, crc, compressed, size, offset });
    return hash.digest('hex');
  }

  /** Writes the central directory and its end record; the archive is complete. */
  async finish(): Promise<void> {
    const start = this.offset;
    for (const entry of this.entries) {
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50, 0);
      record.writeUInt16LE(VERSION, 4);
      record.writeUInt16LE(VERSION, 6);
      record.writeUInt16LE(FLAGS, 8);
      record.writeUInt16LE(DEFLATE, 10);
      record.writeUInt16LE(this.time, 12);
      record.writeUInt16LE(this.date, 14);
      record.writeUInt32LE(entry.crc, 16);
      record.writeUInt32LE(entry.compressed, 20);
      record.writeUInt32LE(entry.size, 24);
      record.writeUInt16LE(entry.name.length, 28);
      // Extra field, comment, disk, attributes (30–41) stay zero.
      record.writeUInt32LE(entry.offset, 42);
      await this.write(Buffer.concat([record, entry.name]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
  }

  private async write(bytes: Buffer) {
    if (this.offset + bytes.length > ZIP32_MAX) throw new ZipTooLargeError();
    this.offset += bytes.length;
    await this.out(bytes);
  }
}
