import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdleTimer } from './idle-timer';

afterEach(() => {
  vi.useRealTimers();
});

describe('createIdleTimer (rule 32)', () => {
  it('locks once after the minutes without activity', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    createIdleTimer(5, onIdle);
    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * 60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('starts the wait again on each activity', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const timer = createIdleTimer(1, onIdle);
    vi.advanceTimersByTime(50_000);
    timer.activity();
    vi.advanceTimersByTime(50_000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('never fires once stopped, and activity after it does not re-arm', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const timer = createIdleTimer(1, onIdle);
    timer.stop();
    timer.activity();
    vi.advanceTimersByTime(120_000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
