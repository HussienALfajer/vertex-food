import type { WhatsAppSessionEvent } from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import { countdown, linkOutcome } from './link-outcome';

function event(type: WhatsAppSessionEvent['type']): WhatsAppSessionEvent {
  return {
    id: '0199f000-0000-7000-8000-000000000001',
    type,
    reason: null,
    platformUserName: null,
    createdAt: '2026-10-28T09:00:00.000Z',
  };
}

describe('linkOutcome', () => {
  it('follows the QR while linking and once connected', () => {
    expect(linkOutcome('linking', undefined)).toBe('linking');
    expect(linkOutcome('connected', undefined)).toBe('connected');
  });

  it('names why this link ended, from the events since it started', () => {
    expect(
      linkOutcome('needs_relink', [
        event('needs_relink'),
        event('duplicate_number'),
        event('created'),
      ]),
    ).toBe('duplicate');
    expect(linkOutcome('needs_relink', [event('link_timeout'), event('relink_started')])).toBe(
      'timeout',
    );
  });

  it('never reads a reason from an earlier link', () => {
    expect(
      linkOutcome('needs_relink', [
        event('needs_relink'),
        event('relink_started'),
        event('duplicate_number'),
      ]),
    ).toBe('failed');
  });

  it('is failed for any other end, or before the events are read', () => {
    expect(linkOutcome('needs_relink', undefined)).toBe('failed');
    expect(linkOutcome('unlinked', [event('unlinked')])).toBe('failed');
    expect(linkOutcome('banned', [])).toBe('failed');
  });
});

describe('countdown', () => {
  const deadline = '2026-10-28T09:03:00.000Z';
  it('shows minutes and seconds left, rounded up', () => {
    expect(countdown(deadline, Date.parse('2026-10-28T09:00:00.000Z'))).toBe('3:00');
    expect(countdown(deadline, Date.parse('2026-10-28T09:02:50.500Z'))).toBe('0:10');
  });
  it('stops at zero', () => {
    expect(countdown(deadline, Date.parse('2026-10-28T09:05:00.000Z'))).toBe('0:00');
  });
});
