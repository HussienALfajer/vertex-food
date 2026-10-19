// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { Form, FormActions, FormFields } from './form';

afterEach(cleanup);

function Sample({
  onSubmit = () => true,
  disabled = false,
  busy = false,
}: {
  onSubmit?: () => boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  const [note, setNote] = useState('');
  return (
    <Form onSubmit={onSubmit} busy={busy}>
      <FormFields>
        <input aria-label="first" />
        <input aria-label="skipped" type="checkbox" />
        <input aria-label="hidden" tabIndex={-1} />
        <textarea
          aria-label="note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <input aria-label="open" role="combobox" aria-expanded="true" aria-controls="list" />
        <input
          aria-label="own"
          onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}
        />
        <input aria-label="disabled" disabled />
        <input aria-label="last" />
      </FormFields>
      <FormActions>
        <Button type="submit" disabled={disabled}>
          save
        </Button>
      </FormActions>
    </Form>
  );
}

const field = (name: string) => screen.getByLabelText(name);

function enter(element: HTMLElement, init: KeyboardEventInit = {}) {
  element.focus();
  return fireEvent.keyDown(element, { key: 'Enter', ...init });
}

describe('Form', () => {
  it('moves to the next field on Enter, skipping what is not a field or not reachable', () => {
    render(<Sample />);
    enter(field('first'));
    expect(document.activeElement).toBe(field('note'));
  });

  it('moves back on Shift+Enter', () => {
    render(<Sample />);
    enter(field('last'), { shiftKey: true });
    expect(document.activeElement).toBe(field('own'));
  });

  it('runs the primary action on Enter in the last field', () => {
    const onSubmit = vi.fn(() => true);
    render(<Sample onSubmit={onSubmit} />);
    enter(field('last'));
    expect(onSubmit).toHaveBeenCalledOnce();
    // The fields lock while it runs: the focus waits on the action.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'save' }));
  });

  it('does nothing on Enter in the last field while the primary action is disabled', () => {
    const onSubmit = vi.fn(() => true);
    render(<Sample onSubmit={onSubmit} disabled />);
    enter(field('last'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('leaves Enter to textareas, open popups and controls that handle it', () => {
    render(<Sample />);
    for (const name of ['note', 'open', 'own']) {
      const event = enter(field(name));
      expect(document.activeElement, name).toBe(field(name));
      // `fireEvent` returns false when the default was prevented: only `own` prevents it.
      expect(event, name).toBe(name !== 'own');
    }
  });

  it('runs the primary action once from its button and never while busy', () => {
    const onSubmit = vi.fn(() => true);
    const { rerender } = render(<Sample onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    rerender(<Sample onSubmit={onSubmit} busy />);
    fireEvent.submit(screen.getByRole('button', { name: 'save' }).closest('form') as HTMLElement);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('locks the fields without a box of their own while busy', () => {
    render(<Sample busy />);
    const fields = field('first').closest('[data-slot="form-fields"]');
    expect(fields?.hasAttribute('inert')).toBe(true);
    expect(fields?.className).toContain('contents');
    expect(field('first').closest('form')?.getAttribute('aria-busy')).toBe('true');
  });

  it('focuses the first invalid control after a failed check', async () => {
    function Invalid() {
      const [checking, setChecking] = useState(false);
      return (
        <Form
          onSubmit={() => {
            setChecking(true);
            return false;
          }}
        >
          <input aria-label="fine" />
          <input aria-label="wrong" aria-invalid={checking || undefined} />
          <Button type="submit">save</Button>
        </Form>
      );
    }
    render(<Invalid />);
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.activeElement).toBe(field('wrong'));
  });
});
