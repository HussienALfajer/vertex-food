'use client';

import { useCallback, useMemo, useState } from 'react';

/**
 * Whether two drafts hold the same values: plain data compared deeply, a missing property equal
 * to one set to `undefined`.
 */
export function sameDraft(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameDraft(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => sameDraft(left[key], right[key]));
}

export interface Draft<T> {
  draft: T;
  setDraft: (next: T | ((current: T) => T)) => void;
  /** The draft differs from the values the form started from (or last saved). */
  dirty: boolean;
  /** Back to the values the form started from. */
  discard: () => void;
  /** New starting values: after a save, or a reload on conflict. */
  reset: (values: T) => void;
}

/**
 * A form's values and whether they changed: Save waits for a change, Discard returns to the
 * start. It does not guard leaving the screen; a screen that needs a confirmation before
 * unsaved changes are dropped adds it from `dirty`.
 */
export function useDraft<T>(initial: T | (() => T)): Draft<T> {
  const [state, setState] = useState(() => {
    const values = typeof initial === 'function' ? (initial as () => T)() : initial;
    return { draft: values, baseline: values };
  });
  const setDraft = useCallback(
    (next: T | ((current: T) => T)) =>
      setState((current) => ({
        ...current,
        draft:
          typeof next === 'function' ? (next as (current: T) => T)(current.draft) : (next as T),
      })),
    [],
  );
  const discard = useCallback(
    () => setState((current) => ({ ...current, draft: current.baseline })),
    [],
  );
  const reset = useCallback((values: T) => setState({ draft: values, baseline: values }), []);
  const dirty = useMemo(() => !sameDraft(state.draft, state.baseline), [state]);
  return { draft: state.draft, setDraft, dirty, discard, reset };
}
