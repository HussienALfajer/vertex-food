import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { whatsappSessionLabelSchema } from '@vertex-food/contracts';
import {
  Button,
  Callout,
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Form,
  FormFields,
  Skeleton,
} from '@vertex-food/ui';
import { CircleCheckIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '../../components/text-field';
import { apiErrorCode } from '../../lib/api';
import { useOnline } from '../../lib/online';
import { QrCode } from '../session/qr-code';
import { useReauth } from '../session/reauth';
import { useWhatsAppErrorText } from './error-text';
import { countdown, type LinkOutcome, linkOutcome } from './link-outcome';
import {
  createWhatsAppSession,
  relinkWhatsAppSession,
  useWhatsAppSessionsChanged,
  whatsappQrQuery,
  whatsappSessionQuery,
} from './queries';

/** The number being linked: a new one (its label asked first) or one already added. */
export type LinkTarget = 'new' | { id: string; label: string };

/**
 * Screen 2: add a number and link it. A new number's label comes first (re-authentication, S02
 * rule 40); then the QR the API returns, read again every 2 s, the countdown to `linkDeadlineAt`
 * and the steps on the phone; then success with the linked phone, or the timeout and
 * duplicate-number states with a retry (a re-link, rule 4 and 5). Re-link opens the same dialog.
 */
export function LinkDialog({
  target,
  onClose,
}: {
  target: LinkTarget | null;
  onClose: () => void;
}) {
  const changed = useWhatsAppSessionsChanged();
  const [session, setSession] = useState<{ id: string; label: string }>();
  // Each opening starts from its target.
  useEffect(() => {
    setSession(target === null || target === 'new' ? undefined : target);
  }, [target]);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (next || busy) return;
        onClose();
        void changed();
      }}
    >
      <DialogContent>
        {target === 'new' && !session ? (
          <LabelStep onBusy={setBusy} onCreated={setSession} />
        ) : session ? (
          <QrStep session={session} onBusy={setBusy} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LabelStep({
  onBusy,
  onCreated,
}: {
  onBusy: (busy: boolean) => void;
  onCreated: (session: { id: string; label: string }) => void;
}) {
  const { t } = useTranslation('console');
  const errorText = useWhatsAppErrorText();
  const withReauth = useReauth();
  const online = useOnline();
  const [label, setLabel] = useState('');
  const [checking, setChecking] = useState(false);
  const parsed = whatsappSessionLabelSchema.safeParse(label);

  const create = useMutation({
    mutationFn: (value: string) => withReauth(() => createWhatsAppSession(value)),
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
    onSuccess: (created) => onCreated({ id: created.id, label: created.label }),
  });

  return (
    <Form
      onSubmit={() => {
        setChecking(true);
        if (!parsed.success) return false;
        create.mutate(parsed.data);
        return true;
      }}
      busy={create.isPending}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <DialogTitle>{t('whatsapp.linkDialog.title')}</DialogTitle>
        <DialogDescription>{t('whatsapp.linkDialog.description')}</DialogDescription>
      </div>
      <FormFields>
        <TextField
          label={t('whatsapp.linkDialog.label')}
          description={t('whatsapp.linkDialog.labelHint')}
          error={checking && !parsed.success ? t('whatsapp.linkDialog.labelInvalid') : undefined}
          autoComplete="off"
          maxLength={40}
          value={label}
          onValueChange={setLabel}
        />
      </FormFields>
      {!online && <Callout role="status" tone="warning" title={t('states.offlineNotice')} />}
      {create.error && <Callout role="alert" tone="danger" title={errorText(create.error)} />}
      <DialogActions>
        <Button type="submit" loading={create.isPending} disabled={!online}>
          {t('whatsapp.linkDialog.submit')}
        </Button>
        <DialogClose
          render={<Button type="button" variant="outline" disabled={create.isPending} />}
        >
          {t('confirm.back')}
        </DialogClose>
      </DialogActions>
    </Form>
  );
}

/** Ticks every second while `on`, for the countdown. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

function QrStep({
  session,
  onBusy,
}: {
  session: { id: string; label: string };
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation('console');
  const errorText = useWhatsAppErrorText();
  const withReauth = useReauth();
  const online = useOnline();
  const queryClient = useQueryClient();
  const changed = useWhatsAppSessionsChanged();
  const qr = useQuery(whatsappQrQuery(session.id));
  // Unlinked elsewhere meanwhile: the API no longer knows the number, so the link cannot end.
  const gone = apiErrorCode(qr.error) === 'NOT_FOUND';
  const state = gone ? undefined : qr.data?.state;
  const ended = state !== undefined && state !== 'linking';
  const detail = useQuery({ ...whatsappSessionQuery(session.id), enabled: ended });
  // Once the link ends, its outcome is read from a fresh copy of the number and its events.
  useEffect(() => {
    if (!ended) return;
    // Exact: the QR's key starts with the number's, and must not be read again.
    void queryClient.invalidateQueries({
      queryKey: whatsappSessionQuery(session.id).queryKey,
      exact: true,
    });
  }, [ended, queryClient, session.id]);
  const now = useNow(state === 'linking');

  const retry = useMutation({
    mutationFn: () => withReauth(() => relinkWhatsAppSession(session.id)),
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
    onSuccess: () => changed(),
  });

  // The events are read only from a copy fetched after the link ended, never an older cached one.
  const fresh =
    detail.data !== undefined && !detail.isFetching && detail.dataUpdatedAt >= qr.dataUpdatedAt;
  const outcome: LinkOutcome | 'gone' | undefined = gone
    ? 'gone'
    : state === undefined || (ended && !fresh)
      ? undefined
      : linkOutcome(state, detail.data?.events);
  const qrText =
    qr.data?.qr && qr.data.expiresAt && Date.parse(qr.data.expiresAt) > now ? qr.data.qr : null;

  const title =
    outcome === 'gone'
      ? t('whatsapp.linkDialog.goneTitle')
      : outcome === 'connected'
        ? t('whatsapp.linkDialog.successTitle')
        : outcome === 'timeout'
          ? t('whatsapp.linkDialog.timeoutTitle')
          : outcome === 'duplicate'
            ? t('whatsapp.linkDialog.duplicateTitle')
            : outcome === 'failed'
              ? t('whatsapp.linkDialog.failedTitle')
              : t('whatsapp.linkDialog.relinkTitle', { label: session.label });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <DialogTitle>{title}</DialogTitle>
        {outcome === 'linking' && (
          <DialogDescription>{t('whatsapp.linkDialog.scanTitle')}</DialogDescription>
        )}
        {outcome === 'connected' && (
          <DialogDescription>
            {t('whatsapp.linkDialog.successDescription', { label: session.label })}
          </DialogDescription>
        )}
        {(outcome === 'timeout' ||
          outcome === 'duplicate' ||
          outcome === 'failed' ||
          outcome === 'gone') && (
          <DialogDescription>{t(`whatsapp.linkDialog.${outcome}Description`)}</DialogDescription>
        )}
      </div>

      {/* A failed read: the first one, or a later one while the last QR is shown (read again). */}
      {qr.isError && !gone && <Callout role="alert" tone="danger" title={errorText(qr.error)} />}
      {ended && detail.isError && (
        <Callout
          role="alert"
          tone="danger"
          title={errorText(detail.error)}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void detail.refetch()}>
              {t('whatsapp.linkDialog.retry')}
            </Button>
          }
        />
      )}

      {outcome === undefined && !qr.isLoadingError && !detail.isError && (
        <div aria-busy="true" className="flex justify-center">
          <span className="sr-only">{t('states.loading')}</span>
          <Skeleton className="size-56" />
        </div>
      )}

      {outcome === 'linking' && qr.data && (
        <div className="flex flex-col items-center gap-4">
          {/* An expired code is never left on screen (a read failed, the gateway is late). */}
          {qrText ? (
            <QrCode value={qrText} label={t('whatsapp.linkDialog.qrLabel')} className="size-56" />
          ) : (
            <div className="flex size-56 items-center justify-center rounded-md bg-muted p-4 text-center text-sm text-muted-foreground">
              {t('whatsapp.linkDialog.qrWaiting')}
            </div>
          )}
          {qr.data.linkDeadlineAt && (
            <p className="text-base font-medium" aria-live="off">
              {Date.parse(qr.data.linkDeadlineAt) > now
                ? t('whatsapp.linkDialog.countdown', {
                    time: countdown(qr.data.linkDeadlineAt, now),
                  })
                : t('whatsapp.linkDialog.closing')}
            </p>
          )}
          <div className="flex w-full flex-col gap-1 text-sm">
            <p className="text-muted-foreground">{t('whatsapp.linkDialog.steps')}</p>
            <p className="font-medium">{t('whatsapp.linkDialog.stepsPath')}</p>
          </div>
        </div>
      )}

      {outcome === 'connected' && detail.data?.session.phone && (
        <p className="flex flex-wrap items-center gap-2 text-base">
          <CircleCheckIcon aria-hidden className="size-5 text-status-success-foreground" />
          <span>{t('whatsapp.linkDialog.linkedPhone')}</span>
          <bdi dir="ltr" className="font-semibold">
            {detail.data.session.phone}
          </bdi>
        </p>
      )}

      {retry.error && <Callout role="alert" tone="danger" title={errorText(retry.error)} />}
      {!online && outcome !== 'connected' && (
        <Callout role="status" tone="warning" title={t('states.offlineNotice')} />
      )}

      <DialogActions>
        {(outcome === 'timeout' || outcome === 'duplicate' || outcome === 'failed') && (
          <Button
            type="button"
            loading={retry.isPending}
            disabled={!online}
            onClick={() => retry.mutate()}
          >
            {t('whatsapp.linkDialog.retry')}
          </Button>
        )}
        <DialogClose
          render={
            <Button
              type="button"
              variant={outcome === 'connected' ? 'primary' : 'outline'}
              disabled={retry.isPending}
            />
          }
        >
          {outcome === 'connected' ? t('whatsapp.linkDialog.done') : t('whatsapp.linkDialog.close')}
        </DialogClose>
      </DialogActions>
    </div>
  );
}
