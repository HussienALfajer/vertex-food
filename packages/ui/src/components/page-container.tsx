import { ArrowRightIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { Button, type ButtonProps } from './button';

/**
 * The column every screen's content and the app header sit in: the header's logo, the navigation
 * and the page's own header and content share the same start and end edges.
 */
function PageContainer({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="page-container"
      className={cn('mx-auto w-full max-w-5xl px-4 sm:px-6', className)}
      {...props}
    />
  );
}

/**
 * The way back from a sub-page, above its title (the desktop app has no browser Back button). The
 * arrow points to the inline start: right in Arabic. Its label names where it goes.
 */
function BackButton({ className, children, ...props }: ButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('-ms-3 w-fit text-muted-foreground hover:text-foreground', className)}
      {...props}
    >
      <ArrowRightIcon aria-hidden className="ltr:rotate-180" />
      {children}
    </Button>
  );
}

export { BackButton, PageContainer };
