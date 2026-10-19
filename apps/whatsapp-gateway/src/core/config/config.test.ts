import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('defaults to the loopback address and port 3102', () => {
    expect(loadConfig({})).toEqual({ host: '127.0.0.1', port: 3102 });
  });

  it('names the bad variables without printing their values', () => {
    const load = () => loadConfig({ GATEWAY_HOST: '', GATEWAY_PORT: '70000' });
    expect(load).toThrow('Invalid gateway environment: GATEWAY_HOST, GATEWAY_PORT');
    expect(load).not.toThrow(/70000/);
  });
});
