import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type HubPairing,
  type NetworkCheckRecord,
  type PairingKind,
  pairingNameSchema,
} from '@vertex-food/contracts';
import {
  Badge,
  Button,
  Callout,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Form,
  FormFields,
  toast,
} from '@vertex-food/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatTime } from '../../lib/format';
import type { OpenedPairing, SyncBridge } from '../../lib/sync';
import { uuidv7 } from '../../lib/uuid';
import { useBridgeErrorText } from '../session/member-picker';
import { TextField } from '../sign-in/sign-in-flow';
import { QrCode } from './qr-code';
import { syncResultsQuery } from './queries';
import { ChoiceField, Detail, Ltr, useOutcomeText } from './sync-parts';
import { countdown, elapsedMs } from './sync-state';

/**
 * The longest stress run this screen sends, within the bridge's sequence limit (10 000,
 * `networkCheckInputSchema`); `@vertex-food/sync` itself is not imported here, as its envelope
 * code needs Node.
 */
const STRESS_MAX = 1000;

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** The fingerprint in groups of four, so it can be compared by eye with the phone's. */
function groups(fingerprint: string): string {
  return fingerprint.match(/.{1,4}/g)?.join(' ') ?? fingerprint;
}

/**
 * Pairing (spec S04 screen 2, rules 33–37), on the active hub, offline too: open for 2 minutes with
 * a kind and a name, then the CA's QR and fingerprint and the pairing QR and code; close by hand.
 */
export function PairingCard({ bridge, open }: { bridge: SyncBridge; open: boolean }) {
  const { t } = useTranslation('sync');
  const bridgeErrorText = useBridgeErrorText();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<PairingKind>('personal');
  const [name, setName] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<OpenedPairing | null>(null);
  const now = useNow(opened !== null);
  const valid = pairingNameSchema.safeParse(name).success;
  // The window closed on the hub (time, a pairing, 5 wrong codes): the codes are gone.
  const current = open && opened && new Date(opened.closesAt).getTime() > now ? opened : null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['device', 'sync'] });
  const close = async () => {
    await bridge.closePairing();
    setOpened(null);
    await refresh();
    toast.add({ title: t('pairing.closed'), type: 'success' });
  };

  return (
    <Card className="gap-4 p-4" data-slot="pairing">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">{t('pairing.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('pairing.description')}</p>
      </div>
      {error && <Callout role="alert" tone="danger" title={error} />}
      {current ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">{t('pairing.openNow')}</Badge>
            <span className="text-sm" aria-live="polite">
              {t('pairing.closesIn', { time: countdown(current.closesAt, now) })}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="font-bold">{t('pairing.caStep')}</h3>
              <p className="text-sm text-muted-foreground">{t('pairing.caHint')}</p>
              <QrCode value={current.caUrl} label={t('pairing.caQr')} />
              <span className="text-sm text-muted-foreground">{t('pairing.fingerprint')}</span>
              <code className="text-sm wrap-anywhere" dir="ltr">
                {groups(current.caFingerprint)}
              </code>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="font-bold">{t('pairing.pairStep')}</h3>
              <QrCode value={current.pairingUrl} label={t('pairing.pairQr')} />
              <span className="text-sm text-muted-foreground">{t('pairing.pairHint')}</span>
              <span className="text-sm text-muted-foreground">{t('pairing.code')}</span>
              <span className="text-3xl font-bold tabular-nums" dir="ltr" data-slot="pairing-code">
                {current.code}
              </span>
            </div>
          </div>
          <Button type="button" variant="secondary" className="self-start" onClick={close}>
            {t('pairing.close')}
          </Button>
        </div>
      ) : open ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="success">{t('pairing.openNow')}</Badge>
          <Button type="button" variant="secondary" onClick={close}>
            {t('pairing.close')}
          </Button>
        </div>
      ) : (
        <Form
          busy={busy}
          className="flex flex-col gap-4"
          onSubmit={() => {
            setChecked(true);
            if (!valid) return false;
            setBusy(true);
            setError(null);
            void bridge
              .openPairing({ kind, name: name.trim() })
              .then(async (result) => {
                if (!result.ok) {
                  setError(bridgeErrorText(result));
                  return;
                }
                setOpened(result.value);
                setName('');
                setChecked(false);
                await refresh();
              })
              .finally(() => setBusy(false));
            return true;
          }}
        >
          <FormFields>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ChoiceField<PairingKind>
                label={t('pairing.kind')}
                value={kind}
                onChange={setKind}
                choices={(['personal', 'station'] as const).map((value) => ({
                  value,
                  label: t(`pairing.kinds.${value}`),
                }))}
              />
              <TextField
                label={t('pairing.name')}
                description={t('pairing.nameHint')}
                maxLength={50}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                error={checked && !valid ? t('pairing.nameInvalid') : undefined}
              />
            </div>
          </FormFields>
          <Button type="submit" className="self-start" loading={busy}>
            {t('pairing.open')}
          </Button>
        </Form>
      )}
    </Card>
  );
}

/** The paired phones and screens, each revocable on either hub-capable PC, offline too (rule 34). */
export function PairedCard({ bridge, pairings }: { bridge: SyncBridge; pairings: HubPairing[] }) {
  const { t } = useTranslation('sync');
  const [revoking, setRevoking] = useState<HubPairing | null>(null);
  return (
    <Card className="gap-4 p-4">
      <h2 className="text-lg font-bold">{t('paired.title')}</h2>
      {pairings.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('paired.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('paired.title')}>
          {pairings.map((pairing) => (
            <li
              key={pairing.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold wrap-anywhere">{pairing.name}</span>
                  <Badge>{t(`pairing.kinds.${pairing.kind}`)}</Badge>
                </div>
                <span className="text-sm text-muted-foreground">
                  {t('paired.lastUsed')}: {formatDateTime(pairing.lastUsedAt)}
                </span>
              </div>
              <Button type="button" variant="secondary" onClick={() => setRevoking(pairing)}>
                {t('paired.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {revoking && (
        <RevokePairingDialog bridge={bridge} pairing={revoking} onClose={() => setRevoking(null)} />
      )}
    </Card>
  );
}

function RevokePairingDialog({
  bridge,
  pairing,
  onClose,
}: {
  bridge: SyncBridge;
  pairing: HubPairing;
  onClose: () => void;
}) {
  const { t } = useTranslation('sync');
  const bridgeErrorText = useBridgeErrorText();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent>
        <DialogTitle>{t('paired.revokeTitle', { name: pairing.name })}</DialogTitle>
        <DialogDescription>{t('paired.revokeDescription')}</DialogDescription>
        {error && <Callout role="alert" tone="danger" title={error} />}
        <DialogActions>
          <Button
            type="button"
            variant="destructive"
            loading={busy}
            onClick={() => {
              setBusy(true);
              void bridge
                .revokePairing(pairing.id)
                .then(async (result) => {
                  if (!result.ok) {
                    setError(bridgeErrorText(result));
                    return;
                  }
                  await queryClient.invalidateQueries({ queryKey: ['sync'] });
                  toast.add({ title: t('paired.revoked'), type: 'success' });
                  onClose();
                })
                .finally(() => setBusy(false));
            }}
          >
            {t('paired.revoke')}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {t('network.cancel')}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

type StressRun = { total: number; sent: number; outboxAtStart: number; running: boolean };

/**
 * The network check (rule 36): one test command, or a stress run of N commands at an interval,
 * through this PC's outbox to the hub; the recent checks show each stage's time after sending and
 * the server's outcome once it arrives.
 */
export function NetworkCheckCard({
  bridge,
  checks,
  sending,
}: {
  bridge: SyncBridge;
  checks: NetworkCheckRecord[];
  /** This PC's commands not yet answered by a hub. */
  sending: number;
}) {
  const { t } = useTranslation('sync');
  const bridgeErrorText = useBridgeErrorText();
  const queryClient = useQueryClient();
  const results = useQuery(syncResultsQuery(bridge));
  const outcomeText = useOutcomeText();
  const [count, setCount] = useState('50');
  const [interval, setIntervalMs] = useState('100');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stress, setStress] = useState<StressRun | null>(null);
  const stop = useRef(false);
  const total = Number(count);
  const pause = Number(interval);
  const validStress =
    Number.isInteger(total) &&
    total >= 1 &&
    total <= STRESS_MAX &&
    Number.isInteger(pause) &&
    pause >= 0 &&
    pause <= 10_000;

  const sendOne = async (run: string, sequence: number) => {
    const result = await bridge.sendNetworkCheck({ run, sequence });
    if (!result.ok) throw new Error(bridgeErrorText(result) ?? '');
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sync'] });

  const sendTest = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendOne(uuidv7(), 1);
      toast.add({ title: t('check.sent'), type: 'success' });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : null);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const runStress = async () => {
    const run = uuidv7();
    stop.current = false;
    setError(null);
    setStress({ total, sent: 0, outboxAtStart: sending, running: true });
    try {
      for (let sequence = 1; sequence <= total && !stop.current; sequence++) {
        await sendOne(run, sequence);
        setStress((current) => current && { ...current, sent: sequence });
        if (pause > 0) await new Promise((done) => setTimeout(done, pause));
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : null);
    } finally {
      setStress((current) => current && { ...current, running: false });
      await refresh();
    }
  };

  const resultOf = (commandId: string) => results.data?.find((result) => result.id === commandId);
  const recent = checks.slice(0, 10);
  // Acknowledged: sent and no longer in this PC's outbox (answered by a hub).
  const acknowledged = stress
    ? Math.max(0, stress.sent - Math.max(0, sending - stress.outboxAtStart))
    : 0;

  return (
    <Card className="gap-4 p-4" data-slot="network-check">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">{t('check.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('check.description')}</p>
      </div>
      {error && <Callout role="alert" tone="danger" title={error} />}
      <Button
        type="button"
        className="self-start"
        loading={busy}
        disabled={stress?.running}
        onClick={() => void sendTest()}
      >
        {t('check.send')}
      </Button>
      <div className="flex flex-col gap-3">
        <h3 className="font-bold">{t('check.stress')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={t('check.count')}
            inputMode="numeric"
            value={count}
            disabled={stress?.running}
            onChange={(event) => setCount(event.currentTarget.value)}
          />
          <TextField
            label={t('check.interval')}
            inputMode="numeric"
            value={interval}
            disabled={stress?.running}
            onChange={(event) => setIntervalMs(event.currentTarget.value)}
            error={validStress ? undefined : t('check.invalid', { max: STRESS_MAX })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {stress?.running ? (
            <Button type="button" variant="secondary" onClick={() => (stop.current = true)}>
              {t('check.stop')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              disabled={!validStress || busy}
              onClick={() => void runStress()}
            >
              {t('check.start')}
            </Button>
          )}
          {stress && (
            <span className="text-sm" aria-live="polite" data-slot="stress-progress">
              {t('check.progress', { sent: stress.sent, total: stress.total, acknowledged })}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="font-bold">{t('check.recent')}</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('check.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label={t('check.recent')}>
            {recent.map((check) => {
              const outcome = resultOf(check.commandId);
              const after = (to: string | null) => {
                const ms = elapsedMs(check.sentAt, to);
                return ms === null ? null : t('check.afterMs', { ms });
              };
              return (
                <li key={check.commandId} className="border-b border-border pb-3 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">
                      {t('check.sequence', { sequence: check.sequence })}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      <Ltr>{formatTime(check.sentAt)}</Ltr>
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm lg:grid-cols-4">
                    <Detail label={t('check.received')}>{after(check.receivedAt)}</Detail>
                    <Detail label={t('check.mirrored')}>
                      {after(check.mirroredAt) ?? t('check.notMirrored')}
                    </Detail>
                    <Detail label={t('check.committed')}>{after(check.committedAt)}</Detail>
                    <Detail label={t('check.outcome')}>
                      {outcome?.outcome && outcome.answeredAt
                        ? `${outcomeText(outcome.outcome)} · ${after(outcome.answeredAt)}`
                        : t('check.waiting')}
                    </Detail>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
