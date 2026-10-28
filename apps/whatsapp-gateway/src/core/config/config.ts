import { z } from 'zod';

/** The role the gateway connects as: it cannot bypass row-level security (ADR 0004). */
export const APP_ROLE = 'food_app';

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

/** Base64 text that decodes to exactly 32 bytes: an AES-256 or HMAC-SHA-256 key. */
const key32 = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/)
  .transform((text) => Buffer.from(text, 'base64'))
  .refine((key) => key.length === 32);

const isAllZero = (bytes: Buffer) => bytes.every((byte) => byte === 0);

/**
 * The gateway's environment, checked once at start-up: a missing or malformed value stops the
 * process before it runs anything. Production refuses the fake transport and the public
 * `.env.example` keys. Error messages name the variable, never its value (the URL carries a
 * password, the keys are secrets).
 */
const configSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    GATEWAY_HOST: z.string().min(1).default('127.0.0.1'),
    GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(3102),
    DATABASE_APP_URL: postgresUrl.refine((url) => new URL(url).username === APP_ROLE),
    /** HMAC-SHA-256 key of recipient hashes, shared with the API and the worker (spec S03). */
    MESSAGING_HASH_KEY: key32,
    /** AES-256-GCM key of sealed recipients, parameters, texts, QR codes and credentials. */
    MESSAGING_ENCRYPTION_KEY: key32,
    /** `fake` sends nothing (tests and development); `baileys` connects to WhatsApp. */
    WHATSAPP_TRANSPORT: z.enum(['fake', 'baileys']),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV !== 'production') return;
    const refuse = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message });
    if (env.WHATSAPP_TRANSPORT === 'fake') refuse('WHATSAPP_TRANSPORT', 'The fake transport');
    if (isAllZero(env.MESSAGING_HASH_KEY)) refuse('MESSAGING_HASH_KEY', 'The example key');
    if (isAllZero(env.MESSAGING_ENCRYPTION_KEY)) {
      refuse('MESSAGING_ENCRYPTION_KEY', 'The example key');
    }
  })
  .transform((env) => ({
    host: env.GATEWAY_HOST,
    port: env.GATEWAY_PORT,
    databaseUrl: env.DATABASE_APP_URL,
    transport: env.WHATSAPP_TRANSPORT,
    messaging: { hashKey: env.MESSAGING_HASH_KEY, encryptionKey: env.MESSAGING_ENCRYPTION_KEY },
  }));

export type Config = z.output<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid gateway environment: ${names.join(', ')}`);
  }
  return result.data;
}
