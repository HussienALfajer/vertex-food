import { Field, FieldDescription, FieldError, FieldLabel, Input } from '@vertex-food/ui';
import { type ComponentProps, useId } from 'react';

type TextFieldProps = {
  label: string;
  description?: string | undefined;
  /** Shown under the field, which is then marked invalid. */
  error?: string | undefined;
} & Omit<ComponentProps<typeof Input>, 'id'>;

/** A labelled input with its hint and its error, as the restaurant app's sign-in has it. */
export function TextField({ label, description, error, ...input }: TextFieldProps) {
  const id = useId();
  return (
    <Field invalid={error !== undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} {...input} />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError match={error !== undefined}>{error}</FieldError>
    </Field>
  );
}

/**
 * The six digits an authenticator app shows (RFC 6238): digits only, read left to right, offered
 * to the browser as a one-time code.
 */
export function TotpField({
  value,
  onValueChange,
  ...props
}: Omit<TextFieldProps, 'value' | 'onValueChange' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <TextField
      inputMode="numeric"
      autoComplete="one-time-code"
      dir="ltr"
      maxLength={6}
      className="max-w-48 text-lg tabular-nums"
      value={value}
      onValueChange={(next) => onValueChange(next.replace(/\D/g, '').slice(0, 6))}
      {...props}
    />
  );
}
