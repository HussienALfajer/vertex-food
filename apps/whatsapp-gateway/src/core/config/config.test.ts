import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const ZERO_KEY = Buffer.alloc(32).toString('base64');
const KEY = Buffer.alloc(32, 7).toString('base64');
const env = {
  DATABASE_APP_URL: 'postgres://food_app:secret-password@localhost:5432/vertex_food',
  MESSAGING_HASH_KEY: ZERO_KEY,
  MESSAGING_ENCRYPTION_KEY: ZERO_KEY,
  WHATSAPP_TRANSPORT: 'fake',
};

describe('loadConfig', () => {
  it('defaults to the loopback address and port 3102', () => {
    const config = loadConfig(env);
    expect(config).toMatchObject({ host: '127.0.0.1', port: 3102, transport: 'fake' });
    expect(config.messaging.hashKey).toHaveLength(32);
  });

  it('requires the database, the messaging keys and the transport', () => {
    expect(() => loadConfig({})).toThrow(
      'Invalid gateway environment: DATABASE_APP_URL, MESSAGING_HASH_KEY, MESSAGING_ENCRYPTION_KEY, WHATSAPP_TRANSPORT',
    );
  });

  it('connects as the app role only', () => {
    const owner = {
      ...env,
      DATABASE_APP_URL: env.DATABASE_APP_URL.replace('food_app', 'food_owner'),
    };
    expect(() => loadConfig(owner)).toThrow('Invalid gateway environment: DATABASE_APP_URL');
  });

  it('refuses keys that are not 32 bytes and unknown transports', () => {
    const load = () =>
      loadConfig({ ...env, MESSAGING_HASH_KEY: 'c2hvcnQ=', WHATSAPP_TRANSPORT: 'twilio' });
    expect(load).toThrow('Invalid gateway environment: MESSAGING_HASH_KEY, WHATSAPP_TRANSPORT');
  });

  it('refuses the fake transport and the example keys in production', () => {
    const production = { ...env, NODE_ENV: 'production' };
    expect(() => loadConfig(production)).toThrow(
      'Invalid gateway environment: WHATSAPP_TRANSPORT, MESSAGING_HASH_KEY, MESSAGING_ENCRYPTION_KEY',
    );
    const real = {
      ...production,
      WHATSAPP_TRANSPORT: 'baileys',
      MESSAGING_HASH_KEY: KEY,
      MESSAGING_ENCRYPTION_KEY: KEY,
    };
    expect(loadConfig(real).transport).toBe('baileys');
  });

  it('names the bad variables without printing their values', () => {
    const load = () => loadConfig({ ...env, GATEWAY_HOST: '', GATEWAY_PORT: '70000' });
    expect(load).toThrow('Invalid gateway environment: GATEWAY_HOST, GATEWAY_PORT');
    expect(load).not.toThrow(/70000|secret-password/);
  });
});
