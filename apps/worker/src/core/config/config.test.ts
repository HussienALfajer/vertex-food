import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

// Fake local URLs; nothing connects here.
const urls = {
  DATABASE_QUEUE_URL: 'postgres://food_queue:fake@localhost:5432/vertex_food',
  DATABASE_JOBS_URL: 'postgres://food_jobs:fake@localhost:5432/vertex_food',
};

describe('loadConfig', () => {
  it('defaults to the loopback address and port 3101', () => {
    expect(loadConfig(urls)).toMatchObject({ host: '127.0.0.1', port: 3101 });
  });

  it('names the bad variables without printing their values', () => {
    const load = () => loadConfig({ ...urls, WORKER_HOST: '', WORKER_PORT: '70000' });
    expect(load).toThrow('Invalid worker environment: WORKER_HOST, WORKER_PORT');
    expect(load).not.toThrow(/70000/);
  });

  it('refuses a URL of the wrong role', () => {
    const swapped = {
      DATABASE_QUEUE_URL: urls.DATABASE_JOBS_URL,
      DATABASE_JOBS_URL: urls.DATABASE_QUEUE_URL,
    };
    expect(() => loadConfig(swapped)).toThrow(
      'Invalid worker environment: DATABASE_QUEUE_URL, DATABASE_JOBS_URL',
    );
    expect(() => loadConfig(swapped)).not.toThrow(/fake/);
  });
});
