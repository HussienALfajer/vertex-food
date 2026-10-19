// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Stepper } from './stepper';

afterEach(cleanup);

const steps = ['1. a', '2. b', '3. c'];

describe('Stepper', () => {
  it('marks completed, current and upcoming steps, one segment each', () => {
    render(<Stepper aria-label="steps" steps={steps} current={1} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-state'))).toEqual([
      'completed',
      'current',
      'upcoming',
    ]);
    expect(items[1]?.getAttribute('aria-current')).toBe('step');
    // Not clickable without onSelect.
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('goes back to a completed step, never forward', () => {
    const onSelect = vi.fn();
    render(<Stepper aria-label="steps" steps={steps} current={1} onSelect={onSelect} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['1. a']);
    fireEvent.click(screen.getByRole('button', { name: '1. a' }));
    expect(onSelect).toHaveBeenCalledWith(0);
  });
});
