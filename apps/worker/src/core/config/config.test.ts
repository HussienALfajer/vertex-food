import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('defaults to the loopback address and port 3101', () => {
    expect(loadConfig({})).toEqual({ host: '127.0.0.1', port: 3101 });
  });

  it('names the bad variables without printing their values', () => {
    const load = () => loadConfig({ WORKER_HOST: '', WORKER_PORT: '70000' });
    expect(load).toThrow('Invalid worker environment: WORKER_HOST, WORKER_PORT');
    expect(load).not.toThrow(/70000/);
  });
});
