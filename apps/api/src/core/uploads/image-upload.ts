import { FileInterceptor } from '@nestjs/platform-express';
import { DomainError, type FilePurpose, imageUploadRules } from '@vertex-food/contracts';

/**
 * The multipart reader of an image route: one part, the file in field `file`, no other field, at
 * most the purpose's upload size. Placed after `RejectedUpload` in `@UseInterceptors`, which turns
 * multer's refusals into `FILE_REJECTED`.
 */
export const imageUpload = (purpose: FilePurpose) =>
  FileInterceptor('file', {
    limits: { fileSize: imageUploadRules[purpose].maxUploadBytes, files: 1, fields: 0, parts: 1 },
  });

export type Upload = { buffer: Buffer } | undefined;

/** The uploaded bytes; an upload without the file is `FILE_REJECTED`. */
export function uploadedBytes(file: Upload): Buffer {
  if (!file) throw new DomainError('FILE_REJECTED', 'No file in the upload');
  return file.buffer;
}
