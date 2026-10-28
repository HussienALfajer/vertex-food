import { describe, expect, it } from 'vitest';
import { inBlock, prepareNumbering } from './numbering.js';

// Numbering from the hub's own block, with provisional labels (spec S04 rules 18, 19).

const commandId = '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f9a7f';
const block = {
  series: 'order' as const,
  businessDate: '2026-10-28',
  first: 1,
  last: 4999,
  lastUsed: 41 as number | null,
};

describe('prepareNumbering', () => {
  it('takes the next number after the last one used, and reports it for the commit', () => {
    const numbering = prepareNumbering({ commandId, businessDate: '2026-10-28', block });
    expect(numbering.used()).toBeNull();
    expect(numbering.take('order')).toEqual({ number: 42, label: null });
    expect(numbering.used()).toEqual({ series: 'order', businessDate: '2026-10-28', number: 42 });
  });

  it('starts at the block’s first number', () => {
    const numbering = prepareNumbering({
      commandId,
      businessDate: '2026-10-28',
      block: { ...block, first: 5001, last: 9999, lastUsed: null },
    });
    expect(numbering.take('order')).toEqual({ number: 5001, label: null });
  });

  it('gives a provisional label when the block is used up or the date has none', () => {
    const usedUp = prepareNumbering({
      commandId,
      businessDate: '2026-10-28',
      block: { ...block, lastUsed: 4999 },
    });
    expect(usedUp.take('order')).toEqual({ number: null, label: '#9a7f' });
    expect(usedUp.used()).toBeNull();
    const none = prepareNumbering({ commandId, businessDate: '2026-11-06', block: null });
    expect(none.take('order')).toEqual({ number: null, label: '#9a7f' });
  });

  it('takes one number per command', () => {
    const numbering = prepareNumbering({ commandId, businessDate: '2026-10-28', block });
    numbering.take('order');
    expect(() => numbering.take('order')).toThrow(/one number/);
  });
});

describe('inBlock', () => {
  it('holds a number between the first and the last of a block', () => {
    expect(inBlock({ first: 5001, last: 9999 }, 5001)).toBe(true);
    expect(inBlock({ first: 5001, last: 9999 }, 4999)).toBe(false);
    expect(inBlock(null, 1)).toBe(false);
  });
});
