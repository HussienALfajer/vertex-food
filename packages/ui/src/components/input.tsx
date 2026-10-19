'use client';

import { Input as InputPrimitive } from '@base-ui/react/input';
import { cn } from '../lib/cn';

function Input({ className, ...props }: InputPrimitive.Props) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        'h-11 w-full min-w-0 rounded-md border border-input bg-surface px-3 text-base text-foreground lg:pointer-fine:h-9',
        'transition-colors duration-150 ease-out placeholder:text-muted-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-muted',
        'aria-invalid:border-destructive-text',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
