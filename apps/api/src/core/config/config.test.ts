import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('reads the database URL and defaults to the loopback address', () => {
    expect(loadConfig({ DATABASE_APP_URL: 'postgres://food_app:fake@localhost:5432/db' })).toEqual({
      databaseUrl: 'postgres://food_app:fake@localhost:5432/db',
      host: '127.0.0.1',
      port: 3100,
    });
  });

  it('names the bad variables without printing their values', () => {
    const load = () =>
      loadConfig({ DATABASE_APP_URL: 'mysql://user:fake-password@host/db', API_PORT: '70000' });
    expect(load).toThrow('Invalid API environment: DATABASE_APP_URL, API_PORT');
    expect(load).not.toThrow(/fake-password/);
  });
});
