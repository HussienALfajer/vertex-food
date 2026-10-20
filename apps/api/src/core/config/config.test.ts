import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const DATABASE_APP_URL = 'postgres://food_app:fake@localhost:5432/db';

describe('loadConfig', () => {
  it('reads the database URL and defaults to the loopback address', () => {
    expect(loadConfig({ DATABASE_APP_URL })).toEqual({
      databaseUrl: DATABASE_APP_URL,
      host: '127.0.0.1',
      port: 3100,
      corsOrigins: ['app://restaurant', 'http://localhost:5273', 'http://localhost:4273'],
    });
  });

  it('allows only the Electron renderer by default in production', () => {
    expect(loadConfig({ DATABASE_APP_URL, NODE_ENV: 'production' }).corsOrigins).toEqual([
      'app://restaurant',
    ]);
  });

  it('reads CORS_ORIGINS as a comma-separated list of exact origins', () => {
    const env = { DATABASE_APP_URL, NODE_ENV: 'production' };
    expect(
      loadConfig({ ...env, CORS_ORIGINS: 'app://restaurant, https://example.test' }).corsOrigins,
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
    expect(() => loadConfig({ DATABASE_APP_URL, CORS_ORIGINS: origins })).toThrow(
      'Invalid API environment: CORS_ORIGINS',
    );
  });

  it('names the bad variables without printing their values', () => {
    const load = () =>
      loadConfig({ DATABASE_APP_URL: 'mysql://user:fake-password@host/db', API_PORT: '70000' });
    expect(load).toThrow('Invalid API environment: DATABASE_APP_URL, API_PORT');
    expect(load).not.toThrow(/fake-password/);
  });
});
