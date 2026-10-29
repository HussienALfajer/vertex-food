import { type ErrorCode, pairingCodeSchema, parsePairingFragment } from '@vertex-food/contracts';
import { Button, Callout, Field, FieldError, FieldLabel, Input } from '@vertex-food/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Screen } from '../components/page-shell';
import { HubApiError, hubOrigin, pair } from '../hub-api';
import { navigate } from '../router';
import type { StoredPairing } from '../storage';

type PairError =
  | { kind: 'code'; code: ErrorCode; retryAfterSeconds: number | null }
  | { kind: 'unreachable' }
  | { kind: 'fingerprint' };

/**
 * Pairs with the hub at the first origin that answers as the hub: the page's own (the PC that
 * served it), then the peers the QR names. A PC that is not the hub answers `NOT_HUB`.
 */
async function pairAnywhere(
  code: string,
  peers: readonly string[],
  expectedFingerprint: string | null,
): Promise<{ ok: true; pairing: StoredPairing } | { ok: false; error: PairError }> {
  const origins = [...new Set([window.location.origin, ...peers.map((peer) => hubOrigin(peer))])];
  let error: PairError = { kind: 'unreachable' };
  for (const origin of origins) {
    try {
      const result = await pair(origin, code);
      // The QR came from the PC's screen: a hub that answers with another CA is not the branch's.
      if (expectedFingerprint && result.caFingerprint !== expectedFingerprint) {
        return { ok: false, error: { kind: 'fingerprint' } };
      }
      return { ok: true, pairing: { ...result, pairedAt: new Date().toISOString() } };
    } catch (caught) {
      if (caught instanceof HubApiError && caught.code && caught.code !== 'NOT_HUB') {
        return {
          ok: false,
          error: { kind: 'code', code: caught.code, retryAfterSeconds: caught.retryAfterSeconds },
        };
      }
      if (caught instanceof HubApiError && caught.code === 'NOT_HUB') {
        error = { kind: 'code', code: 'NOT_HUB', retryAfterSeconds: null };
      }
    }
  }
  return { ok: false, error };
}

/**
 * Screen 7, `/pair`: the pairing QR opens this page with the hub's peers, the CA fingerprint and
 * the code in the fragment (rule 37), which pairs at once and leaves the address bar and history
 * without it; otherwise the member types the 6-digit code. Errors for closed, wrong and locked.
 */
export function PairScreen({ onPaired }: { onPaired: (pairing: StoredPairing) => void }) {
  const { t } = useTranslation('hubClients');
  const { t: errors } = useTranslation('errors');
  const [code, setCode] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PairError | null>(null);
  const fragment = useRef(parsePairingFragment(window.location.hash));

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    const from = fragment.current;
    const result = await pairAnywhere(value, from?.peers ?? [], from?.caFingerprint ?? null);
    setBusy(false);
    if (result.ok) onPaired(result.pairing);
    else setError(result.error);
  };

  // The QR's fragment: read once, then dropped from the address bar and the history. The code is
  // single use, so it is sent once even when React runs the effect twice.
  const sent = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on the QR's fragment.
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', '/pair');
    if (fragment.current && !sent.current) {
      sent.current = true;
      void submit(fragment.current.code);
    }
  }, []);

  const invalid = !pairingCodeSchema.safeParse(code).success;
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!invalid) void submit(code);
  };

  const message =
    error?.kind === 'unreachable'
      ? t('pair.unreachable')
      : error?.kind === 'fingerprint'
        ? t('pair.fingerprintMismatch')
        : error?.code === 'PAIRING_LOCKED' && error.retryAfterSeconds
          ? t('pair.lockedFor', { seconds: error.retryAfterSeconds })
          : error
            ? errors(error.code)
            : null;

  return (
    <Screen heading={t('pair.heading')} description={t('pair.description')}>
      {message && <Callout tone="danger" title={message} role="alert" />}
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Field invalid={checked && invalid}>
          <FieldLabel htmlFor="pairing-code">{t('pair.code')}</FieldLabel>
          <Input
            id="pairing-code"
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            className="text-center text-xl"
          />
          <FieldError match={checked && invalid}>{t('pair.codeInvalid')}</FieldError>
        </Field>
        <Button type="submit" loading={busy}>
          {busy ? t('pair.pairing') : t('pair.submit')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => navigate('/')}>
          {t('pair.install')}
        </Button>
      </form>
    </Screen>
  );
}
