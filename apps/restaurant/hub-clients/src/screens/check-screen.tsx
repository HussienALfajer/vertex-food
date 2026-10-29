import type { HubCommand, HubSession, NetworkCheckRecord } from '@vertex-food/contracts';
import { displayTimeZone, formatLocale } from '@vertex-food/i18n';
import { MAX_NETWORK_CHECK_SEQUENCE } from '@vertex-food/sync';
import { Badge, Button, Callout, Field, FieldError, FieldLabel, Input } from '@vertex-food/ui';
import { SendIcon } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Screen } from '../components/page-shell';
import type { ConnectionState } from '../connection';
import { uuidv7 } from '../uuid';
import { HubStatus } from './hub-status';
import { ReconnectingNotice } from './reconnecting';

const MAX_INTERVAL_MS = 60_000;

const timeFormat = new Intl.DateTimeFormat(formatLocale, {
  timeZone: displayTimeZone,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function between(from: string, to: string): number {
  return Date.parse(to) - Date.parse(from);
}

/** A `sync.network_check` of the member's session: it travels as an order command will. */
function networkCheck(session: HubSession, run: string, sequence: number): HubCommand {
  const now = new Date().toISOString();
  return {
    id: uuidv7(),
    name: 'sync.network_check',
    version: 1,
    payload: { sentAt: now, sequence, run },
    deviceTime: now,
    actor: { kind: 'member', membershipId: session.membershipId, sessionKind: 'hub_client' },
  };
}

type StressRun = { run: string; total: number; ids: string[]; running: boolean };

/**
 * Screen 9, `/check` for a session with `hub.manage` (rule 36): a test command, a stress run of N
 * commands at an interval with the count the hub acknowledged, the outbox («قيد الإرسال 3»), the
 * hub it is talking to and the hub's recent checks with their mirror and commit times.
 */
export function CheckScreen({
  connection,
  session,
  send,
}: {
  connection: ConnectionState;
  session: HubSession;
  send: (command: HubCommand) => void;
}) {
  const { t } = useTranslation('hubClients');
  const { t: sync } = useTranslation('sync');
  const [lastTest, setLastTest] = useState<{ id: string; sentMs: number } | null>(null);
  const [stress, setStress] = useState<StressRun | null>(null);
  const [count, setCount] = useState('200');
  const [interval, setIntervalMs] = useState('100');
  const [checked, setChecked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setStress((current) => current && { ...current, running: false });
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!session.permissions.includes('hub.manage')) {
    return (
      <Screen heading={t('check.heading')}>
        <Callout tone="warning" title={t('check.noPermission')} />
      </Screen>
    );
  }

  const total = Number(count);
  const gap = Number(interval);
  const countInvalid =
    !Number.isInteger(total) || total < 1 || total > MAX_NETWORK_CHECK_SEQUENCE || count === '';
  const intervalInvalid =
    !Number.isInteger(gap) || gap < 0 || gap > MAX_INTERVAL_MS || interval === '';

  const sendTest = () => {
    const command = networkCheck(session, uuidv7(), 1);
    setLastTest({ id: command.id, sentMs: Date.now() });
    send(command);
  };

  const startStress = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (countInvalid || intervalInvalid) return;
    const run: StressRun = { run: uuidv7(), total, ids: [], running: true };
    setStress(run);
    const next = (sequence: number) => {
      const command = networkCheck(session, run.run, sequence);
      run.ids.push(command.id);
      setStress({ ...run });
      send(command);
      if (sequence < total) timer.current = setTimeout(() => next(sequence + 1), gap);
      else stop();
    };
    next(1);
  };

  const acknowledged = stress?.ids.filter((id) => connection.answeredAt.has(id)).length ?? 0;
  const refusal = connection.refusals.at(-1);
  const records = connection.live?.networkChecks ?? [];

  return (
    <Screen heading={t('check.heading')} description={t('check.description')} wide>
      {!connection.hub && <ReconnectingNotice />}
      {refusal && (
        <Callout
          tone="danger"
          role="alert"
          title={t('check.refused', { reason: sync(`reasons.${refusal.reason}`) })}
        />
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <HubStatus connection={connection} />
          <p data-testid="sending" aria-live="polite">
            <Badge tone={connection.sending > 0 ? 'warning' : 'neutral'}>
              {connection.sending > 0
                ? t('check.sending', { count: connection.sending })
                : t('check.nothingSending')}
            </Badge>
          </p>
          <div className="flex flex-col gap-3">
            <Button onClick={sendTest}>
              <SendIcon aria-hidden />
              {t('check.sendTest')}
            </Button>
            {lastTest && (
              <TestResult
                test={lastTest}
                answeredMs={connection.answeredAt.get(lastTest.id) ?? null}
                record={records.find((record) => record.commandId === lastTest.id) ?? null}
              />
            )}
          </div>
          <form
            className="flex flex-col gap-3 rounded-lg border border-border p-3"
            onSubmit={startStress}
            noValidate
            aria-labelledby="stress-heading"
          >
            <h2 id="stress-heading" className="font-semibold">
              {t('check.stress.heading')}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field invalid={checked && countInvalid}>
                <FieldLabel htmlFor="stress-count">{t('check.stress.count')}</FieldLabel>
                <Input
                  id="stress-count"
                  dir="ltr"
                  inputMode="numeric"
                  value={count}
                  onChange={(event) => setCount(event.target.value.replace(/\D/g, ''))}
                />
                <FieldError match={checked && countInvalid}>
                  {t('check.stress.countInvalid')}
                </FieldError>
              </Field>
              <Field invalid={checked && intervalInvalid}>
                <FieldLabel htmlFor="stress-interval">{t('check.stress.interval')}</FieldLabel>
                <Input
                  id="stress-interval"
                  dir="ltr"
                  inputMode="numeric"
                  value={interval}
                  onChange={(event) => setIntervalMs(event.target.value.replace(/\D/g, ''))}
                />
                <FieldError match={checked && intervalInvalid}>
                  {t('check.stress.intervalInvalid')}
                </FieldError>
              </Field>
            </div>
            {stress?.running ? (
              <Button type="button" variant="outline" onClick={stop}>
                {t('check.stress.stop')}
              </Button>
            ) : (
              <Button type="submit" variant="secondary">
                {t('check.stress.start')}
              </Button>
            )}
            {stress && (
              <p data-testid="stress-progress" aria-live="polite">
                {t('check.stress.progress', {
                  sent: stress.ids.length,
                  total: stress.total,
                  acknowledged,
                })}
              </p>
            )}
          </form>
        </div>
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="font-semibold">
            {t('check.recent')}
          </h2>
          {records.length === 0 ? (
            <p className="text-muted-foreground">{t('check.recentEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {records
                .slice(-8)
                .reverse()
                .map((record) => (
                  <li
                    key={record.commandId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <span className="font-medium">
                      {t('check.recentItem', { sequence: record.sequence })}
                    </span>
                    <span className="text-muted-foreground">
                      {timeFormat.format(new Date(record.committedAt))}
                    </span>
                    <span>
                      {record.mirroredAt
                        ? t('check.mirrored', {
                            ms: between(record.receivedAt, record.mirroredAt),
                          })
                        : t('check.notMirrored')}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
    </Screen>
  );
}

/** The last test's times: the page's round trip, then the hub's own (its clock, not the phone's). */
function TestResult({
  test,
  answeredMs,
  record,
}: {
  test: { id: string; sentMs: number };
  answeredMs: number | null;
  record: NetworkCheckRecord | null;
}) {
  const { t } = useTranslation('hubClients');
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm"
      data-testid="last-test"
    >
      <p className="font-medium">{t('check.lastTest')}</p>
      {answeredMs === null ? (
        <p>{t('check.waiting')}</p>
      ) : (
        <p>{t('check.roundTrip', { ms: answeredMs - test.sentMs })}</p>
      )}
      {record && (
        <>
          <p>{t('check.toHub', { ms: between(record.sentAt, record.receivedAt) })}</p>
          <p>
            {record.mirroredAt
              ? t('check.mirrored', { ms: between(record.receivedAt, record.mirroredAt) })
              : t('check.notMirrored')}
          </p>
          <p>{t('check.committed', { ms: between(record.receivedAt, record.committedAt) })}</p>
        </>
      )}
    </div>
  );
}
