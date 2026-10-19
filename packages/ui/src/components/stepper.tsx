'use client';

import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

interface StepperProps extends Omit<ComponentProps<'nav'>, 'onSelect'> {
  /** Each step's label, as shown ("1. Restaurant"). */
  steps: readonly string[];
  /** The index of the current step. */
  current: number;
  /** Go back to a completed step; without it, completed steps are not clickable. */
  onSelect?: ((index: number) => void) | undefined;
  /** The accessible name of the list ("Setup steps"). */
  'aria-label': string;
}

/**
 * The steps of a wizard: one segment per step, its label under it, so a segment reads as its
 * step. Completed steps are filled and, with `onSelect`, go back to that step; the current one is
 * filled and bold; the next ones are empty.
 */
function Stepper({ steps, current, onSelect, className, ...props }: StepperProps) {
  return (
    <nav data-slot="stepper" className={cn(className)} {...props}>
      <ol className="grid auto-cols-fr grid-flow-col gap-2">
        {steps.map((label, index) => {
          const state = index < current ? 'completed' : index === current ? 'current' : 'upcoming';
          const content = (
            <>
              <span
                aria-hidden
                className={cn(
                  'block h-1.5 w-full rounded-sm',
                  state === 'upcoming' ? 'bg-muted' : 'bg-primary',
                )}
              />
              <span
                className={cn(
                  'text-sm',
                  state === 'current' && 'font-bold text-foreground',
                  state === 'completed' && 'text-foreground',
                  state === 'upcoming' && 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </>
          );
          return (
            <li
              key={label}
              data-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
              className="flex min-w-0 flex-col"
            >
              {state === 'completed' && onSelect ? (
                <button
                  type="button"
                  className="flex flex-col gap-2 rounded-sm pb-1 text-start hover:[&>span:last-child]:underline"
                  onClick={() => onSelect(index)}
                >
                  {content}
                </button>
              ) : (
                <div className="flex flex-col gap-2 pb-1">{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export { Stepper, type StepperProps };
