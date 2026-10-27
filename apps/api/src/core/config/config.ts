import { createPrivateKey, type KeyObject } from 'node:crypto';
import { z } from 'zod';

/** The restaurant app's Electron renderer (`apps/restaurant/electron/main.ts`). */
const RENDERER_ORIGIN = 'app://restaurant';

/** The restaurant app's Vite dev server and preview, allowed outside production only. */
const DEVELOPMENT_ORIGINS = ['http://localhost:5273', 'http://localhost:4273'];

/** An exact origin: scheme and host, an optional port, nothing after it. */
const originSchema = z.string().regex(/^[a-z][a-z0-9+.-]*:\/\/[^/\s*?#]+$/);

/** Base64 text that decodes to at least `bytes` bytes. */
const base64Key = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .transform((text) => Buffer.from(text, 'base64'))
    .refine((key) => key.length >= bytes);

/** An Ed25519 private key, base64 of its PKCS #8 DER encoding (one line in `.env`). */
const ed25519PrivateKey = base64Key(32).transform((der, context): KeyObject => {
  try {
    const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType === 'ed25519') return key;
  } catch {
    // Not DER PKCS #8: reported below like any other key.
  }
  context.addIssue({ code: 'custom', message: 'Not an Ed25519 private key' });
  return z.NEVER;
});

const isAllZero = (bytes: Buffer) => bytes.every((byte) => byte === 0);

/** The least proof of work production accepts (ADR 0016); tests use less. */
const MIN_PRODUCTION_POW = 16;

/**
 * The API's environment, checked once at start-up: a missing or malformed value stops the process
 * before it serves anything. Error messages name the variable, never its value (the database URL
 * carries a password, the identity keys are secrets). Copied from Vertex Shifa and adapted.
 */
const configSchema = z
  .object({
    DATABASE_APP_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    NODE_ENV: z.string().optional(),
    CORS_ORIGINS: z
      .string()
      .transform((value) => value.split(',').map((origin) => origin.trim()))
      .pipe(z.array(originSchema).min(1))
      .optional(),
    /** HMAC-SHA-256 key of the keyed hashes (OTP codes, tokens, rate-limit keys); spec S02. */
    IDENTITY_HASH_KEY: base64Key(32),
    /** Signs access tokens, device tokens and tickets (EdDSA); its public key is the JWKS. */
    IDENTITY_TOKEN_KEY: ed25519PrivateKey,
    /** AES-256-GCM key of secrets the server must read back (the console TOTP secrets). */
    IDENTITY_ENCRYPTION_KEY: base64Key(32).refine((key) => key.length === 32),
    /** Leading zero bits of the sign-in proof of work (ADR 0016). */
    IDENTITY_POW_DIFFICULTY: z.coerce.number().int().min(0).max(32).default(18),
    /** Only the fake exists until S03 adds the WhatsApp gateway sender. */
    OTP_SENDER: z.enum(['fake']).default('fake'),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV !== 'production') return;
    const refuse = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message });
    if (env.OTP_SENDER === 'fake') refuse('OTP_SENDER', 'The fake OTP sender');
    // The public `.env.example` keys are all zeros: anyone could sign tokens with them.
    if (isAllZero(env.IDENTITY_HASH_KEY)) refuse('IDENTITY_HASH_KEY', 'The example key');
    const seed = env.IDENTITY_TOKEN_KEY.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
    if (isAllZero(seed)) refuse('IDENTITY_TOKEN_KEY', 'The example key');
    if (isAllZero(env.IDENTITY_ENCRYPTION_KEY)) {
      refuse('IDENTITY_ENCRYPTION_KEY', 'The example key');
    }
    if (env.IDENTITY_POW_DIFFICULTY < MIN_PRODUCTION_POW) {
      refuse('IDENTITY_POW_DIFFICULTY', 'Too easy a proof of work');
    }
  })
  .transform((env) => ({
    databaseUrl: env.DATABASE_APP_URL,
    host: env.API_HOST,
    port: env.API_PORT,
    corsOrigins:
      env.CORS_ORIGINS ??
      (env.NODE_ENV === 'production'
        ? [RENDERER_ORIGIN]
        : [RENDERER_ORIGIN, ...DEVELOPMENT_ORIGINS]),
    production: env.NODE_ENV === 'production',
    identity: {
      hashKey: env.IDENTITY_HASH_KEY,
      tokenKey: env.IDENTITY_TOKEN_KEY,
      encryptionKey: env.IDENTITY_ENCRYPTION_KEY,
      powDifficulty: env.IDENTITY_POW_DIFFICULTY,
      otpSender: env.OTP_SENDER,
    },
  }));

export type Config = z.output<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].join(
      ', ',
    );
    throw new Error(`Invalid API environment: ${names}`);
  }
  return result.data;
}
