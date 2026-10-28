import type { Database } from '@vertex-food/db';
import type { PgBoss } from 'pg-boss';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxDispatcher, SHUTDOWN_WAIT_MS } from './outbox-dispatcher.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('OutboxDispatcher shutdown', () => {
  it('waits for a poll in flight for a bounded time only', async () => {
    vi.useFakeTimers();
    const stuck = { transaction: () => new Promise(() => {}) } as unknown as Database;
    const dispatcher = new OutboxDispatcher(stuck, {} as PgBoss);
    dispatcher.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    let shutDown = false;
    void dispatcher.beforeApplicationShutdown().then(() => {
      shutDown = true;
    });
    await vi.advanceTimersByTimeAsync(SHUTDOWN_WAIT_MS - 1);
    expect(shutDown).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(shutDown).toBe(true);
  });
});
