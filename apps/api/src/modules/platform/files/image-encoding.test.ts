import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { encodeImage } from './image-encoding.js';

// Synthetic images made here; no real logo or photo.

const solid = (width: number, height: number, format: 'png' | 'jpeg' | 'webp' = 'png') =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    [format]()
    .toBuffer();

/** Random pixels compress badly: the worst case for the stored size limits. */
const noise = (width: number, height: number) => {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 2654435761) % 251;
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
};

async function code(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe('encodeImage', () => {
  it('fits a logo inside 512 × 512 on a transparent canvas, as PNG', async () => {
    const logo = await encodeImage('logo', await solid(1000, 500, 'jpeg'));
    expect(logo).toMatchObject({ mediaType: 'image/png', width: 512, height: 512 });
    const { channels, format } = await sharp(logo.bytes).metadata();
    expect(format).toBe('png');
    expect(channels).toBe(4);
    expect(logo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(logo.byteSize).toBe(logo.bytes.length);
  });

  it('crops a cover to 1600 × 600 WebP within 400 KB', async () => {
    const cover = await encodeImage('cover', await noise(2000, 2000));
    expect(cover).toMatchObject({ mediaType: 'image/webp', width: 1600, height: 600 });
    expect(cover.byteSize).toBeLessThanOrEqual(400 * 1024);
  });

  it('keeps a noisy logo under 256 KB', async () => {
    const logo = await encodeImage('logo', await noise(1200, 1200));
    expect(logo.byteSize).toBeLessThanOrEqual(256 * 1024);
  });

  it('strips metadata such as EXIF', async () => {
    const tagged = await sharp(await solid(600, 600, 'jpeg'))
      .withExif({ IFD0: { Copyright: 'synthetic test', Artist: 'synthetic test' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();
    const logo = await encodeImage('logo', tagged);
    expect((await sharp(logo.bytes).metadata()).exif).toBeUndefined();
  });

  it('refuses oversize uploads, other types and undecodable bytes', async () => {
    expect(await code(encodeImage('logo', Buffer.alloc(2 * 1024 * 1024 + 1)))).toBe(
      'FILE_REJECTED',
    );
    expect(await code(encodeImage('logo', Buffer.alloc(0)))).toBe('FILE_REJECTED');
    expect(
      await code(encodeImage('logo', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))),
    ).toBe('FILE_REJECTED');
    expect(await code(encodeImage('logo', Buffer.from('GIF89a not really')))).toBe('FILE_REJECTED');
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } })
      .gif()
      .toBuffer();
    expect(await code(encodeImage('logo', gif))).toBe('FILE_REJECTED');
  });

  it('refuses sides past the limit before decoding them (decompression bombs)', async () => {
    // A tiny file claiming 5000 × 5000: refused from its header.
    const bomb = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    expect(await code(encodeImage('logo', bomb))).toBe('FILE_REJECTED');
    // The cover allows 6000 per side.
    expect(await code(encodeImage('cover', bomb))).toBeUndefined();
  });
});
