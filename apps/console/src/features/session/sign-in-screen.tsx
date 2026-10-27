import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  type ConsoleSetUp,
  mobilePhoneNumberSchema,
  passwordPolicy,
  recoveryCodeSchema,
  setupCodeSchema,
  signInPolicy,
} from '@vertex-food/contracts';
import {
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Form,
  FormActions,
  FormFields,
  PageHeader,
  Stepper,
  toast,
} from '@vertex-food/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OfflineNotice } from '../../components/offline-notice';
import { TextField, TotpField } from '../../components/text-field';
import { apiErrorCode } from '../../lib/api';
import { useErrorText } from '../../lib/error-text';
import { useOnline } from '../../lib/online';
import { PasswordHints, passwordAccepted, passwordHints } from './password-hints';
import { QrCode } from './qr-code';
import { signedIn } from './session';
import { setUp, signIn, verifyTotp } from './sign-in-api';

type Mode = 'password' | 'setupCode';

type SetupStep = {
  kind: 'setup';
  ticket: string;
  phone: string;
  totpSecret: string;
  totpUri: string;
  stage: 'password' | 'authenticator';
  password: string;
  /** The API found the password weak after all: shown on the password stage. */
  passwordRefused: boolean;
};

type Step =
  | { kind: 'credentials'; mode: Mode }
  | { kind: 'totp'; ticket: string }
  | SetupStep
  | { kind: 'recoveryCodes'; codes: string[] };

/**
 * `/sign-in` (screen 14, rules 38–39): phone and password, then a TOTP code or a recovery code. A
 * new or reset user signs in with the setup code instead, chooses a password, adds the console to
 * an authenticator app, confirms it with a code and sees the ten recovery codes once. Tickets and
 * codes stay in this screen's memory only.
 */
export function SignInScreen({ ended }: { ended: boolean }) {
  const { t } = useTranslation('console');
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: 'credentials', mode: 'password' });
  const [expired, setExpired] = useState(false);
  const restart = (mode: Mode) => {
    setExpired(true);
    setStep({ kind: 'credentials', mode });
  };
  const toConsole = () => navigate({ to: '/', replace: true });

  const setup = step.kind === 'setup' || step.kind === 'recoveryCodes';
  const stages = [
    t('setup.steps.password'),
    t('setup.steps.authenticator'),
    t('setup.steps.recoveryCodes'),
  ];
  const credentialsTitle =
    step.kind === 'credentials' && step.mode === 'setupCode'
      ? { title: t('signIn.setupTitle'), description: t('signIn.setupDescription') }
      : { title: t('signIn.title'), description: t('signIn.description') };
  const header = setup
    ? { title: t('setup.title'), description: t('setup.description') }
    : step.kind === 'totp'
      ? { title: t('totp.title'), description: t('totp.description') }
      : credentialsTitle;

  return (
    <section className="flex max-w-xl flex-col gap-6">
      <PageHeader title={header.title} description={header.description} />
      {setup && (
        <Stepper
          aria-label={t('setup.title')}
          steps={stages}
          current={step.kind === 'recoveryCodes' ? 2 : step.stage === 'authenticator' ? 1 : 0}
          onSelect={
            step.kind === 'setup' && step.stage === 'authenticator'
              ? () => setStep({ ...step, stage: 'password' })
              : undefined
          }
        />
      )}
      <OfflineNotice />
      {step.kind === 'credentials' && (
        <CredentialsStep
          key={step.mode}
          mode={step.mode}
          notice={
            expired
              ? { title: t('signIn.ticketExpired') }
              : ended
                ? { title: t('session.ended'), description: t('session.endedHint') }
                : undefined
          }
          onMode={(mode) => {
            setExpired(false);
            setStep({ kind: 'credentials', mode });
          }}
          onNext={(result, phone) => {
            setExpired(false);
            if (result.step === 'totp') setStep({ kind: 'totp', ticket: result.ticket });
            else
              setStep({
                kind: 'setup',
                ticket: result.ticket,
                phone,
                totpSecret: result.totpSecret,
                totpUri: result.totpUri,
                stage: 'password',
                password: '',
                passwordRefused: false,
              });
          }}
        />
      )}
      {step.kind === 'totp' && (
        <TotpStep ticket={step.ticket} onExpired={() => restart('password')} onDone={toConsole} />
      )}
      {step.kind === 'setup' && step.stage === 'password' && (
        <SetupPasswordStep
          step={step}
          onNext={(password) =>
            setStep({ ...step, stage: 'authenticator', password, passwordRefused: false })
          }
        />
      )}
      {step.kind === 'setup' && step.stage === 'authenticator' && (
        <AuthenticatorStep
          step={step}
          onExpired={() => restart('setupCode')}
          onWeakPassword={() => setStep({ ...step, stage: 'password', passwordRefused: true })}
          onDone={(codes) => setStep({ kind: 'recoveryCodes', codes })}
        />
      )}
      {step.kind === 'recoveryCodes' && (
        <RecoveryCodesStep codes={step.codes} onContinue={toConsole} />
      )}
    </section>
  );
}

type SignInResult = Awaited<ReturnType<typeof signIn>>;

/** Phone with the password, or with the one-time setup code (rule 38). */
function CredentialsStep({
  mode,
  notice,
  onMode,
  onNext,
}: {
  mode: Mode;
  notice: { title: string; description?: string } | undefined;
  onMode: (mode: Mode) => void;
  onNext: (result: SignInResult, phone: string) => void;
}) {
  const { t } = useTranslation('console');
  const errorText = useErrorText();
  const online = useOnline();
  const [phone, setPhone] = useState('');
  const [secret, setSecret] = useState('');
  const [checking, setChecking] = useState(false);
  const parsed = mobilePhoneNumberSchema.safeParse(phone);
  const setupCode = setupCodeSchema.safeParse(secret);
  const secretValid = mode === 'password' ? secret !== '' : setupCode.success;
  const phoneError = checking && !parsed.success ? t('signIn.phoneInvalid') : undefined;
  const secretError =
    checking && !secretValid
      ? mode === 'password'
        ? t('signIn.passwordRequired')
        : t('signIn.setupCodeInvalid')
      : undefined;

  const send = useMutation({
    // The answer may hold the new TOTP secret: never kept once the step is gone.
    gcTime: 0,
    mutationFn: (e164: string) =>
      signIn(
        mode === 'password'
          ? { phone: e164, password: secret }
          : { phone: e164, setupCode: setupCodeSchema.parse(secret) },
      ),
    onSuccess: (result, e164) => onNext(result, e164),
  });

  const submit = () => {
    setChecking(true);
    if (!parsed.success || !secretValid) return false;
    send.mutate(parsed.data);
    return true;
  };

  return (
    <div className="flex flex-col gap-4">
      <Form onSubmit={submit} busy={send.isPending}>
        <Card>
          {notice && !send.error && <Callout role="status" tone="warning" {...notice} />}
          <FormFields>
            <TextField
              label={t('signIn.phone')}
              description={t('signIn.phoneHint')}
              error={phoneError}
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="username"
              autoFocus
              value={phone}
              onValueChange={setPhone}
            />
            {mode === 'password' ? (
              <TextField
                label={t('signIn.password')}
                error={secretError}
                type="password"
                autoComplete="current-password"
                maxLength={passwordPolicy.maxLength}
                value={secret}
                onValueChange={setSecret}
              />
            ) : (
              <TextField
                label={t('signIn.setupCode')}
                description={t('signIn.setupCodeHint')}
                error={secretError}
                dir="ltr"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                value={secret}
                onValueChange={setSecret}
              />
            )}
          </FormFields>
          <FormActions>
            <Button type="submit" loading={send.isPending} disabled={!online}>
              {t('signIn.submit')}
            </Button>
          </FormActions>
          {send.isPending && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('signIn.working')}
            </p>
          )}
          {send.error && (
            <Callout
              role="alert"
              tone="danger"
              title={errorText(send.error)}
              description={
                apiErrorCode(send.error) === 'RATE_LIMITED'
                  ? t('signIn.lockedHint', { count: signInPolicy.lockMinutes })
                  : undefined
              }
            />
          )}
        </Card>
      </Form>
      <div>
        <Button
          type="button"
          variant="link"
          // The long Arabic label wraps on a 360 px phone instead of widening the page.
          className="h-auto min-h-11 max-w-full shrink px-0 text-start whitespace-normal"
          disabled={send.isPending}
          onClick={() => onMode(mode === 'password' ? 'setupCode' : 'password')}
        >
          {mode === 'password' ? t('signIn.withSetupCode') : t('signIn.withPassword')}
        </Button>
      </div>
    </div>
  );
}

/** Rule 39: the authenticator's code, or one of the ten recovery codes. */
function TotpStep({
  ticket,
  onExpired,
  onDone,
}: {
  ticket: string;
  onExpired: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation('console');
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const online = useOnline();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const recoveryCode = recoveryCodeSchema.safeParse(code);

  const verify = useMutation({
    mutationFn: (value: string) => verifyTotp(ticket, value),
    onSuccess: (me) => {
      signedIn(queryClient, me);
      onDone();
    },
    onError: (error) => {
      if (apiErrorCode(error) === 'TICKET_INVALID') onExpired();
      else if (!recovery) setCode('');
    },
  });
  const refused = verify.error ? errorText(verify.error) : undefined;

  const submit = () => {
    setChecking(true);
    if (recovery) {
      if (!recoveryCode.success) return false;
      verify.mutate(recoveryCode.data);
      return true;
    }
    if (code.length !== 6) return false;
    verify.mutate(code);
    return true;
  };

  return (
    <Form onSubmit={submit} busy={verify.isPending}>
      <Card>
        <FormFields>
          {recovery ? (
            <TextField
              label={t('totp.recoveryLabel')}
              description={t('totp.recoveryHint')}
              error={checking && !recoveryCode.success ? t('totp.recoveryInvalid') : refused}
              dir="ltr"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              value={code}
              onValueChange={setCode}
            />
          ) : (
            <TotpField
              label={t('totp.label')}
              error={refused}
              value={code}
              onValueChange={setCode}
              autoFocus
            />
          )}
        </FormFields>
        <FormActions>
          <Button
            type="submit"
            loading={verify.isPending}
            disabled={!online || (!recovery && code.length !== 6)}
          >
            {t('totp.verify')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            // The long Arabic label wraps on a 360 px phone instead of widening the page.
            className="h-auto min-h-11 max-w-full shrink py-1.5 text-start whitespace-normal"
            disabled={verify.isPending}
            onClick={() => {
              setRecovery(!recovery);
              setCode('');
              setChecking(false);
              verify.reset();
            }}
          >
            {recovery ? t('totp.useTotp') : t('totp.useRecoveryCode')}
          </Button>
        </FormActions>
        {recovery && <p className="text-sm text-muted-foreground">{t('totp.recoveryNoReauth')}</p>}
        {apiErrorCode(verify.error) === 'RATE_LIMITED' && (
          <Callout
            role="alert"
            tone="danger"
            title={errorText(verify.error)}
            description={t('signIn.lockedHint', { count: signInPolicy.lockMinutes })}
          />
        )}
      </Card>
    </Form>
  );
}

/** Setup, first stage: the password, checked here as the API will. */
function SetupPasswordStep({
  step,
  onNext,
}: {
  step: SetupStep;
  onNext: (password: string) => void;
}) {
  const { t } = useTranslation(['console', 'errors']);
  const [password, setPassword] = useState(step.password);
  const [checking, setChecking] = useState(step.passwordRefused);
  const hints = passwordHints(password, step.phone);
  const refused = step.passwordRefused && password === step.password;
  const error = refused
    ? t('errors:PASSWORD_TOO_WEAK')
    : checking && !passwordAccepted(hints)
      ? t('password.weak')
      : undefined;

  const submit = () => {
    setChecking(true);
    if (refused || !passwordAccepted(hints)) return false;
    onNext(password);
    return true;
  };

  return (
    <Form onSubmit={submit}>
      <Card>
        <FormFields>
          <TextField
            label={t('setup.newPassword')}
            error={error}
            type="password"
            autoComplete="new-password"
            maxLength={passwordPolicy.maxLength}
            autoFocus
            value={password}
            onValueChange={setPassword}
          />
          <PasswordHints hints={hints} />
        </FormFields>
        <FormActions>
          <Button type="submit">{t('setup.next')}</Button>
        </FormActions>
      </Card>
    </Form>
  );
}

/** The secret in groups of four, as authenticator apps show it. */
function grouped(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

/** Setup, second stage: the QR code of the new secret and a code that proves it was added. */
function AuthenticatorStep({
  step,
  onExpired,
  onWeakPassword,
  onDone,
}: {
  step: SetupStep;
  onExpired: () => void;
  onWeakPassword: () => void;
  onDone: (codes: string[]) => void;
}) {
  const { t } = useTranslation('console');
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const online = useOnline();
  const [code, setCode] = useState('');

  const confirm = useMutation({
    // The answer holds the recovery codes, shown once (rule 39).
    gcTime: 0,
    mutationFn: (value: string) => setUp(step.ticket, step.password, value),
    onSuccess: (result: ConsoleSetUp) => {
      signedIn(queryClient, result);
      onDone(result.recoveryCodes);
    },
    onError: (error) => {
      const failure = apiErrorCode(error);
      if (failure === 'TICKET_INVALID') onExpired();
      else if (failure === 'PASSWORD_TOO_WEAK') onWeakPassword();
      else setCode('');
    },
  });

  const submit = () => {
    if (code.length !== 6) return false;
    confirm.mutate(code);
    return true;
  };

  return (
    <Form onSubmit={submit} busy={confirm.isPending}>
      <Card>
        <CardHeader>
          <CardTitle>{t('setup.scanTitle')}</CardTitle>
          <CardDescription>{t('setup.scanDescription')}</CardDescription>
        </CardHeader>
        <div className="flex flex-col items-start gap-3">
          <QrCode value={step.totpUri} label={t('setup.qrLabel')} />
          <p className="text-sm text-muted-foreground">{t('setup.manualKey')}</p>
          <bdi dir="ltr" className="text-lg font-medium tabular-nums wrap-anywhere select-all">
            {grouped(step.totpSecret)}
          </bdi>
        </div>
        <FormFields>
          <TotpField
            label={t('setup.confirmLabel')}
            error={confirm.error ? errorText(confirm.error) : undefined}
            value={code}
            onValueChange={setCode}
          />
        </FormFields>
        <FormActions>
          <Button type="submit" loading={confirm.isPending} disabled={!online || code.length !== 6}>
            {t('setup.confirm')}
          </Button>
        </FormActions>
      </Card>
    </Form>
  );
}

/** Setup, last stage: the ten recovery codes, shown this once (rule 39). */
function RecoveryCodesStep({ codes, onContinue }: { codes: string[]; onContinue: () => void }) {
  const { t } = useTranslation('console');
  const [saved, setSaved] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.add({ title: t('recoveryCodes.copied'), type: 'success' });
    } catch {
      toast.add({ title: t('recoveryCodes.copyFailed'), type: 'error' });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recoveryCodes.title')}</CardTitle>
        <CardDescription>{t('recoveryCodes.description')}</CardDescription>
      </CardHeader>
      <ul
        aria-label={t('recoveryCodes.listLabel')}
        dir="ltr"
        className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-md border border-border p-4 text-lg font-medium tabular-nums sm:grid-cols-2"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div>
        <Button type="button" variant="outline" onClick={() => void copy()}>
          {t('recoveryCodes.copy')}
        </Button>
      </div>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the checkbox inside is the control. */}
      <label className="flex min-h-11 w-fit items-center gap-3 text-base">
        <Checkbox checked={saved} onCheckedChange={setSaved} />
        {t('recoveryCodes.saved')}
      </label>
      <div>
        <Button type="button" disabled={!saved} onClick={onContinue}>
          {t('recoveryCodes.continue')}
        </Button>
      </div>
    </Card>
  );
}
