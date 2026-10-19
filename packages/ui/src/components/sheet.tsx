'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from '../lib/cn';
import { overlayMotion } from '../lib/motion';

/**
 * A panel sliding in from the inline-start edge (the right in RTL), e.g. the navigation on phones
 * and tablets (Vertex Hub's sheet).
 */
const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetTitle = DialogPrimitive.Title;

function SheetOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn('fixed inset-0 z-50 bg-overlay', overlayMotion, className)}
      {...props}
    />
  );
}

function SheetContent({ className, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <SheetOverlay />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col shadow-float outline-none',
          'transition-transform duration-250 ease-out',
          'ltr:data-starting-style:-translate-x-full ltr:data-ending-style:-translate-x-full',
          'rtl:data-starting-style:translate-x-full rtl:data-ending-style:translate-x-full',
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetClose, SheetContent, SheetOverlay, SheetTitle, SheetTrigger };
