'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { dialogMotion, overlayMotion } from '../lib/motion';

/**
 * A modal dialog centered on the screen, full width on a phone (a PIN pad, a confirmation, a
 * password re-entry). Base UI traps the focus and gives it back on close.
 */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({ className, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="dialog-overlay"
        className={cn('fixed inset-0 z-50 bg-overlay', overlayMotion)}
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed inset-x-4 top-1/2 z-50 mx-auto flex max-h-[calc(100dvh-2rem)] max-w-md -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl bg-surface p-5 text-foreground shadow-float outline-none',
          dialogMotion,
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg font-semibold text-foreground', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

/** The dialog's actions, the primary one first (at the start edge). */
function DialogActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-actions"
      className={cn('flex flex-wrap items-center gap-3', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
};
