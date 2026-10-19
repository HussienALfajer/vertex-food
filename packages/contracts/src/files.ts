import { z } from 'zod';
import { idSchema, instantSchema } from './primitives.js';

/**
 * Images a tenant uploads (module `files`): the logo and the cover (S01). Stored re-encoded in
 * PostgreSQL until hosting is decided (Q1), served with their stored media type.
 */
export const filePurposeSchema = z.enum(['logo', 'cover']).meta({ id: 'FilePurpose' });

export type FilePurpose = z.infer<typeof filePurposeSchema>;

/** What an upload may be and what it is stored as (spec S01 rule 19). */
export const imageUploadRules = {
  logo: {
    acceptedTypes: ['image/png', 'image/jpeg', 'image/webp'],
    maxUploadBytes: 2 * 1024 * 1024,
    maxUploadSide: 4096,
    /** Fitted inside this box on a transparent canvas. */
    width: 512,
    height: 512,
    mediaType: 'image/png',
    maxStoredBytes: 256 * 1024,
  },
  cover: {
    acceptedTypes: ['image/png', 'image/jpeg', 'image/webp'],
    maxUploadBytes: 5 * 1024 * 1024,
    maxUploadSide: 6000,
    /** Fitted and cropped to exactly this size. */
    width: 1600,
    height: 600,
    mediaType: 'image/webp',
    maxStoredBytes: 400 * 1024,
  },
} as const satisfies Record<FilePurpose, unknown>;

export const fileSchema = z
  .object({
    id: idSchema,
    purpose: filePurposeSchema,
    mediaType: z.enum(['image/png', 'image/webp']),
    byteSize: z.int().min(1),
    width: z.int().min(1),
    height: z.int().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: instantSchema,
  })
  .meta({ id: 'File' });

export type StoredFile = z.infer<typeof fileSchema>;
