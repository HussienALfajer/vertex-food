'use client';

import {
  type ComponentProps,
  createContext,
  type FormEvent,
  type KeyboardEvent,
  useContext,
} from 'react';
import { cn } from '../lib/cn';

/** Controls Enter moves between: text entry, and the triggers of selects and comboboxes. */
const FIELD_SELECTOR = [
  'input:not([type="hidden"],[type="checkbox"],[type="radio"],[type="file"],[type="button"],[type="submit"],[type="reset"],[type="image"],[type="range"],[type="color"])',
  'textarea',
  '[role="combobox"]',
].join(',');

/**
 * Where a failed check sends the focus: an invalid control, or the first control of an invalid
 * field (`Field` sets `data-invalid`) or group (`data-form-invalid`).
 */
const INVALID_SELECTOR = '[aria-invalid="true"], [data-invalid], [data-form-invalid]';

function isAvailable(element: HTMLElement): boolean {
  if (element.matches(':disabled') || element.tabIndex < 0) return false;
  if (element.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
  // jsdom has no layout: it lacks `checkVisibility`.
  return typeof element.checkVisibility !== 'function' || element.checkVisibility();
}

/** The fields of `form` that Enter and Shift+Enter move between, in document order. */
function formFields(form: HTMLFormElement): HTMLElement[] {
  return [...form.querySelectorAll<HTMLElement>(FIELD_SELECTOR)].filter(isAvailable);
}

/**
 * Whether Enter on `target` moves to the next field. A textarea keeps its newline; buttons,
 * toggles and the triggers of selects keep their own Enter, and so does an open combobox.
 */
function movesOnEnter(target: EventTarget): target is HTMLInputElement {
  return (
    target instanceof HTMLInputElement &&
    target.matches(FIELD_SELECTOR) &&
    target.getAttribute('aria-expanded') !== 'true'
  );
}

function submitButton(form: HTMLFormElement): HTMLButtonElement | null {
  return form.querySelector<HTMLButtonElement>('button[type="submit"]');
}

const FormBusyContext = createContext(false);

interface FormProps extends Omit<ComponentProps<'form'>, 'onSubmit'> {
  /**
   * The form's primary action (Save, Next), run by its submit button or by Enter on the last field.
   * It returns whether the values passed their checks: on `false` the focus goes to the first
   * invalid control once the errors show, unless the user moved it meanwhile.
   */
  onSubmit: () => boolean;
  /** A save is running: `FormFields` are locked, the layout does not move. */
  busy?: boolean;
}

/**
 * A form with the keyboard rules of every Vertex Food form: Enter moves to the next field and on
 * the last one runs the primary action; Shift+Enter moves back. A textarea keeps its newline, and an
 * open select, combobox or menu, or a control that handles Enter itself, keeps its Enter. The
 * primary action is the one `type="submit"` button; while it is disabled, Enter on the last field
 * does nothing.
 */
function Form({ onSubmit, busy = false, className, onKeyDown, children, ...props }: FormProps) {
  function keyDown(event: KeyboardEvent<HTMLFormElement>) {
    onKeyDown?.(event);
    if (
      event.defaultPrevented ||
      event.key !== 'Enter' ||
      event.nativeEvent.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !movesOnEnter(event.target)
    ) {
      return;
    }
    event.preventDefault();
    const form = event.currentTarget;
    const fields = formFields(form);
    const next = fields[fields.indexOf(event.target) + (event.shiftKey ? -1 : 1)];
    if (next) {
      next.focus();
      if (next instanceof HTMLInputElement) next.select();
    } else if (!event.shiftKey) {
      // A click runs the button's own checks: disabled, or busy (focusable while disabled).
      submitButton(form)?.click();
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter ?? submitButton(form);
    // The fields lock while the action runs: the focus waits on the action, not on a locked field.
    if (submitter instanceof HTMLElement && document.activeElement !== submitter) {
      submitter.focus();
    }
    const focused = document.activeElement;
    if (!onSubmit()) {
      requestAnimationFrame(() => {
        // On a slow PC the frame can come after the user clicked into a field and started typing:
        // moving the focus then would send their keys to another field.
        if (document.activeElement !== focused) return;
        const invalid = form.querySelector<HTMLElement>(INVALID_SELECTOR);
        if (!invalid) return;
        const target = invalid.matches(FIELD_SELECTOR)
          ? invalid
          : (formFields(form).find((field) => invalid.contains(field)) ??
            invalid.querySelector<HTMLElement>('button:not(:disabled)'));
        (target ?? invalid).focus();
        if (!target) invalid.scrollIntoView({ block: 'center' });
      });
    }
  }

  return (
    <FormBusyContext.Provider value={busy}>
      <form
        data-slot="form"
        noValidate
        aria-busy={busy || undefined}
        className={cn(className)}
        onKeyDown={keyDown}
        onSubmit={submit}
        {...props}
      >
        {children}
      </form>
    </FormBusyContext.Provider>
  );
}

/**
 * The form's controls. While the form is busy they are `inert`: nothing can change them, nothing
 * dims or moves. It adds no box of its own, so the controls stay in the form's layout.
 */
function FormFields({ className, ...props }: ComponentProps<'div'>) {
  const busy = useContext(FormBusyContext);
  return (
    <div data-slot="form-fields" inert={busy} className={cn('contents', className)} {...props} />
  );
}

/** The row of the primary action and its companions (Discard changes, Previous). */
function FormActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="form-actions"
      className={cn('flex flex-wrap items-center gap-3', className)}
      {...props}
    />
  );
}

export { Form, FormActions, FormFields, type FormProps, formFields };
