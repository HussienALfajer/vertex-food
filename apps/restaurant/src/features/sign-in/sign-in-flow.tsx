import {
  accountNameSchema,
  mobilePhoneNumberSchema,
  type OtpVerified,
  otpCodeSchema,
  otpPolicy,
  passwordPolicy,
  type SignInIntent,
  signInPolicy,
  solveProofOfWork,
} from '@vertex-food/contracts';
import {
  Button,
  Callout,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Form,
  FormActions,
  FormFields,
  Input,
  toast,
} from '@vertex-food/ui';
import { WifiOffIcon } from 'lucide-react';
import { type ComponentProps, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, apiErrorCode, body, unwrap } from '../../lib/api';
import { useErrorText } from '../../lib/error-text';
import { useOnline } from '../../lib/online';

const TICKET_HEADER = 'x-sign-in-ticket';

/** Why a code is asked for without a password: a first sign-in, or an authorized reset (rule 14). */
type CodePurpose = 'first_sign_in' | 'password_reset';

type Step =
  | { kind: 'credentials' }
  | { kind: 'code'; purpose: CodePurpose }
  | { kind: 'otp'; challengeId: string; sentAt: number }
  | { kind: 'password'; ticket: string; needsName: boolean; suggestedName: string | null };

/** A proof of work for a sign-in or OTP request (ADR 0016), solved here. */
async function proofOfWork() {
  return solveProofOfWork(await unwrap(api.POST('/api/auth/pow')));
}

function TextField({
  label,
  description,
  error,
  ...input
}: { label: string; description?: string; error?: string | undefined } & ComponentProps<
  typeof Input
>) {
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

/** Seconds left before a resend, ticking each second. */
function useCooldown(sentAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((sentAt + otpPolicy.resendCooldownSeconds * 1000 - now) / 1000));
}

/**
 * Signing in (spec S02 screen 2, rules 10–14): phone and password, then the OTP on a device new to
 * the person; or a first sign-in, where an OTP leads to the name and the first password; or a
 * forgotten password whose reset an owner, a manager or Vertex support authorized, where an OTP
 * leads to the new password. Ends with a `signed_in` ticket for `onSignedIn`. Online only.
 */
export function SignInFlow({
  intent,
  onSignedIn,
}: {
  intent: SignInIntent;
  onSignedIn: (ticket: string) => Promise<void> | void;
}) {
  const { t } = useTranslation('restaurant');
  const online = useOnline();
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [phone, setPhone] = useState('');

  return (
    <div className="flex flex-col gap-5">
      {!online && (
        <Callout
          role="status"
          tone="warning"
          icon={<WifiOffIcon aria-hidden />}
          title={t('signIn.offline')}
        />
      )}
      {step.kind === 'credentials' && (
        <CredentialsStep
          intent={intent}
          phone={phone}
          onPhone={setPhone}
          onOtp={(challengeId) => setStep({ kind: 'otp', challengeId, sentAt: Date.now() })}
          onDone={onSignedIn}
          onCode={(purpose) => setStep({ kind: 'code', purpose })}
        />
      )}
      {step.kind === 'code' && (
        <CodeRequestStep
          key={step.purpose}
          purpose={step.purpose}
          intent={intent}
          phone={phone}
          onPhone={setPhone}
          onSent={(challengeId) => setStep({ kind: 'otp', challengeId, sentAt: Date.now() })}
          onBack={() => setStep({ kind: 'credentials' })}
        />
      )}
      {step.kind === 'otp' && (
        <OtpStep
          key={step.challengeId}
          intent={intent}
          challengeId={step.challengeId}
          sentAt={step.sentAt}
          onResent={(challengeId) => setStep({ kind: 'otp', challengeId, sentAt: Date.now() })}
          onVerified={(verified: OtpVerified) =>
            verified.needsPassword
              ? setStep({
                  kind: 'password',
                  ticket: verified.ticket,
                  needsName: verified.needsName,
                  suggestedName: verified.suggestedName,
                })
              : onSignedIn(verified.ticket)
          }
          onBack={() => setStep({ kind: 'credentials' })}
        />
      )}
      {step.kind === 'password' && (
        <PasswordStep
          ticket={step.ticket}
          needsName={step.needsName}
          suggestedName={step.suggestedName}
          onDone={onSignedIn}
        />
      )}
    </div>
  );
}

/** Runs a request of a step: busy while it runs, its refusal's text after. */
function useStepAction() {
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>, refusal?: (code: string) => string | null) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(refusal?.(apiErrorCode(failure) ?? '') ?? errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function CredentialsStep({
  intent,
  phone,
  onPhone,
  onOtp,
  onDone,
  onCode,
}: {
  intent: SignInIntent;
  phone: string;
  onPhone: (phone: string) => void;
  onOtp: (challengeId: string) => void;
  onDone: (ticket: string) => Promise<void> | void;
  onCode: (purpose: CodePurpose) => void;
}) {
  const { t } = useTranslation('restaurant');
  const online = useOnline();
  const { busy, error, run } = useStepAction();
  const [password, setPassword] = useState('');
  const [checked, setChecked] = useState(false);
  const parsedPhone = mobilePhoneNumberSchema.safeParse(phone);
  const errors = {
    phone: parsedPhone.success ? undefined : t('signIn.phoneInvalid'),
    password: password ? undefined : t('signIn.passwordRequired'),
  };

  const submit = () => {
    setChecked(true);
    if (!parsedPhone.success || errors.password) return false;
    void run(
      async () => {
        const result = await unwrap(
          api.POST('/api/auth/sign-in', {
            body: { phone: parsedPhone.data, password, intent, proofOfWork: await proofOfWork() },
          }),
        );
        if (result.step === 'otp') onOtp(result.challengeId);
        else await onDone(result.ticket);
      },
      (code) =>
        code === 'RATE_LIMITED' ? t('signIn.locked', { minutes: signInPolicy.lockMinutes }) : null,
    );
    return true;
  };

  return (
    <Form onSubmit={submit} busy={busy} className="flex flex-col gap-4">
      {error && <Callout role="alert" tone="danger" title={error} />}
      <FormFields>
        <TextField
          label={t('signIn.phone')}
          description={t('signIn.phoneHint')}
          type="tel"
          dir="ltr"
          autoComplete="tel"
          value={phone}
          onChange={(event) => onPhone(event.currentTarget.value)}
          error={checked ? errors.phone : undefined}
        />
        <TextField
          label={t('signIn.password')}
          type="password"
          autoComplete="current-password"
          maxLength={passwordPolicy.maxLength}
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          error={checked ? errors.password : undefined}
        />
      </FormFields>
      <FormActions>
        <Button type="submit" loading={busy} disabled={!online}>
          {t('signIn.submit')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onCode('first_sign_in')}>
          {t('signIn.firstTime')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onCode('password_reset')}>
          {t('signIn.forgotPassword')}
        </Button>
      </FormActions>
    </Form>
  );
}

/** The phone for a code without a password: the API answers the same whether one is sent. */
function CodeRequestStep({
  purpose,
  intent,
  phone,
  onPhone,
  onSent,
  onBack,
}: {
  purpose: CodePurpose;
  intent: SignInIntent;
  phone: string;
  onPhone: (phone: string) => void;
  onSent: (challengeId: string) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation('restaurant');
  const online = useOnline();
  const { busy, error, run } = useStepAction();
  const [checked, setChecked] = useState(false);
  const parsedPhone = mobilePhoneNumberSchema.safeParse(phone);

  const submit = () => {
    setChecked(true);
    if (!parsedPhone.success) return false;
    void run(async () => {
      const { challengeId } = await unwrap(
        api.POST('/api/auth/otp/request', {
          body: {
            phone: parsedPhone.data,
            purpose,
            intent,
            proofOfWork: await proofOfWork(),
          },
        }),
      );
      onSent(challengeId);
    });
    return true;
  };

  return (
    <Form onSubmit={submit} busy={busy} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">
          {purpose === 'first_sign_in' ? t('signIn.firstTitle') : t('signIn.resetTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {purpose === 'first_sign_in' ? t('signIn.firstDescription') : t('signIn.resetDescription')}
        </p>
      </div>
      {error && <Callout role="alert" tone="danger" title={error} />}
      <FormFields>
        <TextField
          label={t('signIn.phone')}
          description={t('signIn.phoneHint')}
          type="tel"
          dir="ltr"
          autoComplete="tel"
          value={phone}
          onChange={(event) => onPhone(event.currentTarget.value)}
          error={checked && !parsedPhone.success ? t('signIn.phoneInvalid') : undefined}
        />
      </FormFields>
      <FormActions>
        <Button type="submit" loading={busy} disabled={!online}>
          {t('signIn.sendCode')}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          {t('signIn.backToSignIn')}
        </Button>
      </FormActions>
    </Form>
  );
}

function OtpStep({
  intent,
  challengeId,
  sentAt,
  onResent,
  onVerified,
  onBack,
}: {
  intent: SignInIntent;
  challengeId: string;
  sentAt: number;
  onResent: (challengeId: string) => void;
  onVerified: (verified: OtpVerified) => Promise<void> | void;
  onBack: () => void;
}) {
  const { t } = useTranslation('restaurant');
  const online = useOnline();
  const { busy, error, run } = useStepAction();
  const cooldown = useCooldown(sentAt);
  const [code, setCode] = useState('');
  const [checked, setChecked] = useState(false);
  const valid = otpCodeSchema.safeParse(code).success;

  const submit = () => {
    setChecked(true);
    if (!valid) return false;
    void run(async () => {
      await onVerified(
        await unwrap(api.POST('/api/auth/otp/verify', { body: { challengeId, code, intent } })),
      );
    });
    return true;
  };
  const resend = () =>
    void run(async () => {
      const next = await unwrap(api.POST('/api/auth/otp/resend', { body: { challengeId } }));
      toast.add({ title: t('signIn.resent'), type: 'success' });
      onResent(next.challengeId);
    });

  return (
    <Form onSubmit={submit} busy={busy} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">{t('signIn.otpTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('signIn.otpDescription')}</p>
      </div>
      {error && <Callout role="alert" tone="danger" title={error} />}
      <FormFields>
        <TextField
          label={t('signIn.otp')}
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          maxLength={otpPolicy.digits}
          value={code}
          onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, ''))}
          error={checked && !valid ? t('signIn.otpInvalid') : undefined}
        />
      </FormFields>
      <FormActions>
        <Button type="submit" loading={busy} disabled={!online}>
          {t('signIn.verify')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!online || busy || cooldown > 0}
          onClick={resend}
        >
          {cooldown > 0 ? t('signIn.resendIn', { seconds: cooldown }) : t('signIn.resend')}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          {t('signIn.backToSignIn')}
        </Button>
      </FormActions>
    </Form>
  );
}

function PasswordStep({
  ticket,
  needsName,
  suggestedName,
  onDone,
}: {
  ticket: string;
  needsName: boolean;
  suggestedName: string | null;
  onDone: (ticket: string) => Promise<void> | void;
}) {
  const { t } = useTranslation('restaurant');
  const online = useOnline();
  const { busy, error, run } = useStepAction();
  const [name, setName] = useState(suggestedName ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [checked, setChecked] = useState(false);
  const errors = {
    name:
      needsName && !accountNameSchema.safeParse(name).success ? t('signIn.nameInvalid') : undefined,
    password:
      password.length < passwordPolicy.minLength || password.length > passwordPolicy.maxLength
        ? t('signIn.passwordTooShort')
        : undefined,
    confirm: confirm === password ? undefined : t('signIn.passwordMismatch'),
  };

  const submit = () => {
    setChecked(true);
    if (errors.name || errors.password || errors.confirm) return false;
    void run(async () => {
      const next = await unwrap(
        api.POST('/api/auth/password', {
          body: body({ name: needsName ? name.trim() : undefined, password }),
          headers: { [TICKET_HEADER]: ticket },
        }),
      );
      await onDone(next.ticket);
    });
    return true;
  };

  return (
    <Form onSubmit={submit} busy={busy} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">{t('signIn.passwordTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('signIn.passwordDescription')}</p>
      </div>
      {error && <Callout role="alert" tone="danger" title={error} />}
      <FormFields>
        {needsName && (
          <TextField
            label={t('signIn.name')}
            autoComplete="name"
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            error={checked ? errors.name : undefined}
          />
        )}
        <TextField
          label={t('signIn.newPassword')}
          description={t('signIn.passwordHints')}
          type="password"
          autoComplete="new-password"
          maxLength={passwordPolicy.maxLength}
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          error={checked ? errors.password : undefined}
        />
        <TextField
          label={t('signIn.confirmPassword')}
          type="password"
          autoComplete="new-password"
          maxLength={passwordPolicy.maxLength}
          value={confirm}
          onChange={(event) => setConfirm(event.currentTarget.value)}
          error={checked ? errors.confirm : undefined}
        />
      </FormFields>
      <FormActions>
        <Button type="submit" loading={busy} disabled={!online}>
          {t('signIn.savePassword')}
        </Button>
      </FormActions>
    </Form>
  );
}

export { proofOfWork, TextField, TICKET_HEADER, useStepAction };
