import { useQuery } from '@tanstack/react-query';
import { type CommandSummary, decisionReasonSchema } from '@vertex-food/contracts';
import {
  Button,
  Callout,
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Form,
  FormFields,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@vertex-food/ui';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type DeviceBridge, deviceBridge } from '../../lib/device';
import { useErrorText } from '../../lib/error-text';
import { deviceStatusQuery, useMe } from '../session/queries';
import { isReauthCancelled } from '../session/reauth';

/** A command's summary from its `describe` (an i18n key of `sync` and its parameters). */
export function useCommandSummary(): (
  summary: CommandSummary | null,
  name: string | null,
) => string {
  const { t, i18n } = useTranslation('sync');
  // The key comes from the command's definition, so it is not one TypeScript knows.
  const text = t as unknown as (key: string, params?: Record<string, unknown>) => string;
  return (summary, name) =>
    summary && i18n.exists(summary.key, { ns: 'sync' })
      ? text(summary.key, summary.params)
      : text('unknownCommand', { name: name ?? '' });
}

/** The names a member id stands for: the PC's member list, or the signed-in member. */
export function useMemberNames(): (membershipId: string | null) => string {
  const { t } = useTranslation('sync');
  const me = useMe();
  const device = useQuery({
    ...deviceStatusQuery(deviceBridge as DeviceBridge),
    enabled: deviceBridge !== null,
  });
  const members = device.data?.state === 'registered' ? device.data.members : [];
  return (membershipId) => {
    if (membershipId === null) return t('attention.station');
    if (me?.membershipId === membershipId) return me.displayName;
    return (
      members.find((member) => member.membershipId === membershipId)?.name ??
      t('attention.unknownMember')
    );
  };
}

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="wrap-anywhere text-foreground">{children}</dd>
    </div>
  );
}

/** A Latin value (an address, a version, a fingerprint) keeping its own direction. */
export function Ltr({ children }: { children: ReactNode }) {
  return <span dir="ltr">{children}</span>;
}

/** A select of fixed choices, labelled. */
export function ChoiceField<T extends string>({
  label,
  value,
  onChange,
  choices,
  placeholder,
  disabled = false,
  invalid = false,
}: {
  label: string;
  value: T | null;
  onChange: (value: T) => void;
  choices: readonly { value: T; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <Field invalid={invalid} disabled={disabled} className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as T)}
        items={choices}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/**
 * A decision with a written reason (closing an attention item, rejecting a quarantine batch): 3 to
 * 500 characters, recorded in the audit. `submit` may run through `useSensitive`; a closed password
 * dialog shows nothing.
 */
export function ReasonDialog({
  title,
  description,
  label,
  invalidText,
  action,
  destructive = false,
  cancelLabel,
  submit,
  onClose,
}: {
  title: string;
  description: string;
  label: string;
  invalidText: string;
  action: string;
  destructive?: boolean;
  cancelLabel: string;
  submit: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const errorText = useErrorText();
  const id = useId();
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = decisionReasonSchema.safeParse(reason).success;
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent>
        <Form
          busy={busy}
          className="flex flex-col gap-4"
          onSubmit={() => {
            setChecked(true);
            if (!valid) return false;
            setBusy(true);
            setError(null);
            void submit(reason.trim())
              .then(onClose)
              .catch((failure: unknown) => {
                if (!isReauthCancelled(failure)) setError(errorText(failure));
              })
              .finally(() => setBusy(false));
            return true;
          }}
        >
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {error && <Callout role="alert" tone="danger" title={error} />}
          <FormFields>
            <Field invalid={checked && !valid}>
              <FieldLabel htmlFor={id}>{label}</FieldLabel>
              <Textarea
                id={id}
                value={reason}
                maxLength={500}
                rows={3}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
              <FieldError match={checked && !valid}>{invalidText}</FieldError>
            </Field>
          </FormFields>
          <DialogActions>
            <Button type="submit" variant={destructive ? 'destructive' : 'primary'} loading={busy}>
              {action}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              {cancelLabel}
            </Button>
          </DialogActions>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
