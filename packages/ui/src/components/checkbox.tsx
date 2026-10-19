'use client';

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { CheckIcon } from 'lucide-react';
import { cn } from '../lib/cn';

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'relative flex size-5 shrink-0 items-center justify-center rounded-sm border border-input bg-surface text-primary-foreground',
        // A 44 px touch area around the 20 px box (AGENTS.md, responsive).
        "after:absolute after:-inset-3 after:content-['']",
        'transition-colors duration-150 ease-out',
        'data-checked:border-primary data-checked:bg-primary',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:border-destructive-text',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex data-unchecked:hidden">
        <CheckIcon className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
