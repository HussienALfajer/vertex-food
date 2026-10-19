'use client';

import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2Icon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent font-medium whitespace-nowrap select-none',
    'transition-colors duration-150 ease-out',
    'disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary-hover',
        outline: 'border-border bg-surface text-foreground hover:bg-muted aria-expanded:bg-muted',
        ghost: 'text-foreground hover:bg-muted aria-expanded:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive-hover',
        link: 'text-foreground underline-offset-4 hover:underline',
      },
      size: {
        sm: "h-8 px-3 text-sm [&_svg:not([class*='size-'])]:size-4",
        md: 'h-9 px-4 text-base',
        lg: 'h-10 px-5 text-base',
        icon: 'size-9',
        'icon-sm': "size-8 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /**
     * Its action is running (a save): a spinner takes the label's place at the same width, and
     * the button stays focusable but does nothing.
     */
    loading?: boolean;
  };

/**
 * A button, or with `render` the rendered element (a router link) styled as one. A rendered link
 * keeps its own semantics: it is announced as a link, and Base UI's button behaviour, which
 * expects a native `<button>`, applies only when `nativeButton` is passed.
 */
function Button({ className, variant, size, loading = false, children, ...props }: ButtonProps) {
  const classes = cn(
    buttonVariants({ variant, size }),
    // Busy, not unavailable: it keeps its full color.
    loading && 'relative data-disabled:opacity-100',
    className,
  );
  if (props.render && props.nativeButton === undefined) {
    const { render, disabled: _disabled, focusableWhenDisabled: _focusable, ...rest } = props;
    return (
      <StyledElement
        render={render as useRender.ComponentProps<'a'>['render']}
        className={classes}
        {...(rest as ComponentProps<'a'>)}
      >
        {children}
      </StyledElement>
    );
  }
  if (!loading) {
    return (
      <ButtonPrimitive data-slot="button" className={classes} {...props}>
        {children}
      </ButtonPrimitive>
    );
  }
  return (
    <ButtonPrimitive
      data-slot="button"
      className={classes}
      {...props}
      disabled
      focusableWhenDisabled
      aria-busy
    >
      {/* Transparent, not hidden: the label keeps the width and the accessible name. */}
      <span className="inline-flex items-center gap-2 opacity-0">{children}</span>
      <span className="absolute inset-0 flex items-center justify-center">
        <Loader2Icon aria-hidden className="animate-spin" />
      </span>
    </ButtonPrimitive>
  );
}

function StyledElement({ render, ...props }: useRender.ComponentProps<'a'>) {
  return useRender({
    defaultTagName: 'a',
    render,
    props: mergeProps<'a'>({ 'data-slot': 'button' } as ComponentProps<'a'>, props),
  });
}

export { Button, type ButtonProps, buttonVariants };
