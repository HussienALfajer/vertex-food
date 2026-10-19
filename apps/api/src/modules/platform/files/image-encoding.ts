import { createHash } from 'node:crypto';
import { DomainError, type FilePurpose, imageUploadRules } from '@vertex-food/contracts';
import sharp, { type Metadata } from 'sharp';

const FORMATS = new Set(['png', 'jpeg', 'webp']);

export type EncodedImage = {
  purpose: FilePurpose;
  mediaType: 'image/png' | 'image/webp';
  bytes: Buffer;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
};

const rejected = (reason: string) => new DomainError('FILE_REJECTED', `Image rejected: ${reason}`);

/**
 * Decodes an uploaded logo or cover and re-encodes it (spec S01 rule 19): the logo fitted inside
 * 512 × 512 on a transparent canvas as PNG, the cover fitted and cropped to 1600 × 600 as WebP.
 * Only pixels we produced are stored and served: sharp writes no metadata (EXIF, locations) unless
 * asked. The upload's declared type is not trusted, the decoder decides, and the pixel limit set
 * before decoding stops decompression bombs. Adapted from Vertex Shifa's `logo-image.ts`.
 */
export async function encodeImage(purpose: FilePurpose, upload: Buffer): Promise<EncodedImage> {
  const rules = imageUploadRules[purpose];
  if (upload.length === 0 || upload.length > rules.maxUploadBytes) throw rejected('size');
  const options = {
    limitInputPixels: rules.maxUploadSide * rules.maxUploadSide,
    failOn: 'error',
  } as const;
  let metadata: Metadata;
  try {
    metadata = await sharp(upload, options).metadata();
  } catch {
    throw rejected('undecodable');
  }
  if (!metadata.format || !FORMATS.has(metadata.format)) throw rejected('format');
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > rules.maxUploadSide ||
    metadata.height > rules.maxUploadSide
  ) {
    throw rejected('dimensions');
  }
  const resized = await sharp(upload, options)
    .rotate()
    .resize(
      rules.width,
      rules.height,
      purpose === 'logo'
        ? { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }
        : { fit: 'cover', position: 'attention' },
    )
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch(() => {
      throw rejected('undecodable');
    });
  const pixels = () => sharp(resized.data, { raw: resized.info });
  // Each attempt is smaller than the last; a photo-like image needs the later ones.
  const attempts =
    purpose === 'logo'
      ? [
          () => pixels().png({ compressionLevel: 9 }).toBuffer(),
          () => pixels().png({ palette: true, compressionLevel: 9 }).toBuffer(),
        ]
      : [80, 65, 50, 35].map((quality) => () => pixels().webp({ quality }).toBuffer());
  for (const attempt of attempts) {
    const bytes = await attempt();
    if (bytes.length > rules.maxStoredBytes) continue;
    return {
      purpose,
      mediaType: rules.mediaType,
      bytes,
      byteSize: bytes.length,
      width: resized.info.width,
      height: resized.info.height,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  throw rejected('encoded size');
}
