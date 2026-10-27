import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const DATABASE_APP_URL = 'postgres://food_app:fake@localhost:5432/db';

// The all-zero example keys of `.env.example`.
const EXAMPLE = {
  IDENTITY_HASH_KEY: Buffer.alloc(32).toString('base64'),
  IDENTITY_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  IDENTITY_TOKEN_KEY: 'MC4CAQAwBQYDK2VwBCIEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};

const REAL = {
  IDENTITY_HASH_KEY: randomBytes(32).toString('base64'),
  IDENTITY_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  IDENTITY_TOKEN_KEY: generateKeyPairSync('ed25519')
    .privateKey.export({ format: 'der', type: 'pkcs8' })
    .toString('base64'),
};

const base = { DATABASE_APP_URL, ...EXAMPLE };

describe('loadConfig', () => {
  it('reads the database URL and defaults to the loopback address', () => {
    expect(loadConfig(base)).toMatchObject({
      databaseUrl: DATABASE_APP_URL,
      host: '127.0.0.1',
      port: 3100,
      corsOrigins: [
        'app://restaurant',
        'http://localhost:5273',
        'http://localhost:4273',
        'http://localhost:5274',
        'http://localhost:4274',
      ],
      production: false,
      identity: { powDifficulty: 18, otpSender: 'fake' },
    });
  });

  it('allows only the Electron renderer by default in production', () => {
    const env = { ...base, ...REAL, NODE_ENV: 'production', OTP_SENDER: undefined };
    // Production refuses the fake sender, the only one until S03.
    expect(() => loadConfig(env)).toThrow('Invalid API environment: OTP_SENDER');
  });

  it('reads CORS_ORIGINS as a comma-separated list of exact origins', () => {
    expect(
      loadConfig({ ...base, CORS_ORIGINS: 'app://restaurant, https://example.test' }).corsOrigins,
    ).toEqual(['app://restaurant', 'https://example.test']);
  });

  it.each([
    '*',
    'https://*.example.test',
    'https://example.test/',
    'https://example.test/path',
    'example.test',
    'app://restaurant,',
  ])('refuses the CORS origin %s', (origins) => {
    expect(() => loadConfig({ ...base, CORS_ORIGINS: origins })).toThrow(
      'Invalid API environment: CORS_ORIGINS',
    );
  });

  it('names the bad variables without printing their values', () => {
    const load = () =>
      loadConfig({
        ...base,
        DATABASE_APP_URL: 'mysql://user:fake-password@host/db',
        API_PORT: '70000',
      });
    expect(load).toThrow('Invalid API environment: DATABASE_APP_URL, API_PORT');
    expect(load).not.toThrow(/fake-password/);
  });

  it('requires the identity keys, and an Ed25519 token key', () => {
    expect(() => loadConfig({ DATABASE_APP_URL })).toThrow(
      'Invalid API environment: IDENTITY_HASH_KEY, IDENTITY_TOKEN_KEY, IDENTITY_ENCRYPTION_KEY',
    );
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    expect(() => loadConfig({ ...base, IDENTITY_TOKEN_KEY: rsa })).toThrow(
      'Invalid API environment: IDENTITY_TOKEN_KEY',
    );
    expect(() =>
      loadConfig({ ...base, IDENTITY_HASH_KEY: randomBytes(16).toString('base64') }),
    ).toThrow('Invalid API environment: IDENTITY_HASH_KEY');
  });

  it('refuses in production the example keys, the fake sender and an easy proof of work', () => {
    const production = { DATABASE_APP_URL, NODE_ENV: 'production' };
    expect(() => loadConfig({ ...production, ...EXAMPLE, IDENTITY_POW_DIFFICULTY: '4' })).toThrow(
      'Invalid API environment: OTP_SENDER, IDENTITY_HASH_KEY, IDENTITY_TOKEN_KEY, IDENTITY_ENCRYPTION_KEY, IDENTITY_POW_DIFFICULTY',
    );
    expect(() => loadConfig({ ...production, ...REAL })).toThrow(
      'Invalid API environment: OTP_SENDER',
    );
  });
});
