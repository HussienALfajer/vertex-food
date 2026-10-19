import { type ReactNode, useId } from 'react';

/** Controls that share one label (an image's buttons, a list of phones, a day's periods). */
export function FieldGroup({
  legend,
  description,
  error,
  disabled,
  children,
}: {
  legend: string;
  description?: string | undefined;
  error?: string | undefined;
  disabled?: boolean;
  children: ReactNode;
}) {
  const errorId = useId();
  return (
    <fieldset
      disabled={disabled}
      aria-describedby={error ? errorId : undefined}
      aria-invalid={error ? true : undefined}
      // A failed save sends the focus to the first invalid group (`Form`).
      data-form-invalid={error ? '' : undefined}
      className="flex min-w-0 flex-col gap-2"
    >
      <legend className="mb-2 text-sm font-medium text-foreground">{legend}</legend>
      {children}
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {/* Announced when it appears; the fieldset names it as its description. */}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </fieldset>
  );
}
