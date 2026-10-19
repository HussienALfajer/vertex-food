// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { sameDraft, useDraft } from './use-draft';

describe('sameDraft', () => {
  it('compares plain data deeply', () => {
    expect(sameDraft({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toBe(true);
    expect(sameDraft({ a: [1, { b: 'x' }] }, { a: [1, { b: 'y' }] })).toBe(false);
    expect(sameDraft([1, 2], [1, 2, 3])).toBe(false);
    expect(sameDraft({ a: [] }, { a: {} })).toBe(false);
    expect(sameDraft(null, {})).toBe(false);
  });

  it('treats a missing property as undefined', () => {
    expect(sameDraft({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });
});

describe('useDraft', () => {
  it('is dirty once the values differ, and clean again when they come back', () => {
    const { result } = renderHook(() => useDraft({ name: 'a', phones: ['1'] }));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setDraft((draft) => ({ ...draft, phones: ['1', '2'] })));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.setDraft({ name: 'a', phones: ['1'] }));
    expect(result.current.dirty).toBe(false);
  });

  it('discards back to the start and resets to saved values', () => {
    const { result } = renderHook(() => useDraft(() => ({ name: 'a' })));
    act(() => result.current.setDraft({ name: 'b' }));
    act(() => result.current.discard());
    expect(result.current.draft).toEqual({ name: 'a' });
    act(() => result.current.setDraft({ name: 'c' }));
    act(() => result.current.reset({ name: 'c' }));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.discard());
    expect(result.current.draft).toEqual({ name: 'c' });
  });
});
