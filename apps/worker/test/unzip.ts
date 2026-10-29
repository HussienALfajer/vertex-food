import { crc32, inflateRawSync } from 'node:zlib';

/** One file of a ZIP, read back. */
export type UnzippedEntry = {
  path: string;
  bytes: Buffer;
  modified: { date: number; time: number };
};

/**
 * Reads a whole ZIP through its central directory, as an unzip tool does, and checks each entry's
 * CRC and sizes: the tests' independent reading of what the worker wrote.
 */
export function unzip(archive: Buffer): UnzippedEntry[] {
  const end = archive.length - 22;
  if (archive.readUInt32LE(end) !== 0x06054b50) throw new Error('No end of central directory');
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  if (at + archive.readUInt32LE(end + 12) !== end) throw new Error('Central directory size');
  const entries: UnzippedEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(at) !== 0x02014b50) throw new Error('Central directory record');
    const method = archive.readUInt16LE(at + 10);
    const time = archive.readUInt16LE(at + 12);
    const date = archive.readUInt16LE(at + 14);
    const crc = archive.readUInt32LE(at + 16);
    const compressed = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extra = archive.readUInt16LE(at + 30);
    const comment = archive.readUInt16LE(at + 32);
    const offset = archive.readUInt32LE(at + 42);
    const path = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + extra + comment;

    if (archive.readUInt32LE(offset) !== 0x04034b50) throw new Error(`${path}: local header`);
    const localName = archive.readUInt16LE(offset + 26);
    const localExtra = archive.readUInt16LE(offset + 28);
    if (archive.subarray(offset + 30, offset + 30 + localName).toString('utf8') !== path) {
      throw new Error(`${path}: local name`);
    }
    const start = offset + 30 + localName + localExtra;
    const data = archive.subarray(start, start + compressed);
    const descriptor = start + compressed;
    if (archive.readUInt32LE(descriptor) !== 0x08074b50) throw new Error(`${path}: descriptor`);
    if (
      archive.readUInt32LE(descriptor + 4) !== crc ||
      archive.readUInt32LE(descriptor + 8) !== compressed ||
      archive.readUInt32LE(descriptor + 12) !== size
    ) {
      throw new Error(`${path}: descriptor differs from the central directory`);
    }
    if (method !== 8) throw new Error(`${path}: not Deflate`);
    const bytes = inflateRawSync(data);
    if (bytes.length !== size || crc32(bytes) !== crc) throw new Error(`${path}: CRC or size`);
    entries.push({ path, bytes, modified: { date, time } });
  }
  return entries;
}
