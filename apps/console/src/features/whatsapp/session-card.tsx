import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { PlatformWhatsAppSession, WhatsAppSessionState } from '@vertex-food/contracts';
import { Badge, Button, Card, cn, DialogTrigger, toast } from '@vertex-food/ui';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { formatDateTime } from '../../lib/format';
import { useReauth } from '../session/reauth';
import { useWhatsAppErrorText } from './error-text';
import type { LinkTarget } from './link-dialog';
import {
  pauseWhatsAppSession,
  relinkWhatsAppSession,
  unlinkWhatsAppSession,
  useWhatsAppSessionsChanged,
} from './queries';

const stateTone = {
  linking: 'info',
  connected: 'success',
  disconnected: 'warning',
  needs_relink: 'danger',
  banned: 'danger',
  unlinked: 'neutral',
} as const satisfies Record<WhatsAppSessionState, string>;

/** The states an admin re-links from (spec S03, "Session states"). */
const relinkable = new Set<WhatsAppSessionState>(['needs_relink', 'banned', 'disconnected']);

/**
 * A platform number (screens 1 and 3): label, phone, state, pause and its reason, warm-up day,
 * 24-hour sends against the cap with a bar, first contacts against their share, the hour's sends,
 * the last connection. `manager` (`console.messaging.manage`, cosmetic: the API decides) adds the
 * actions; support sees none.
 */
export function SessionCard({
  session,
  manager,
  disabled,
  detailLink,
  onLink,
  onUnlinked,
}: {
  session: PlatformWhatsAppSession;
  manager: boolean;
  /** Offline: actions wait for the connection. */
  disabled: boolean;
  /** On the list: a link to the number's page. */
  detailLink?: boolean;
  onLink: (target: LinkTarget) => void;
  onUnlinked?: () => void;
}) {
  const { t } = useTranslation('console');
  return (
    <Card className="gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 text-lg font-semibold wrap-anywhere">{session.label}</h2>
        <Badge tone={stateTone[session.state]}>{t(`whatsapp.states.${session.state}`)}</Badge>
        {session.pauseReason && (
          <Badge tone="warning">
            {t('whatsapp.paused', { reason: t(`whatsapp.pauseReasons.${session.pauseReason}`) })}
          </Badge>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">{t('whatsapp.phone')}</dt>
          <dd>{session.phone ? <bdi dir="ltr">{session.phone}</bdi> : t('whatsapp.noPhone')}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">{t('whatsapp.warmUp')}</dt>
          <dd>
            {session.warmUpDay === null
              ? t('whatsapp.noPhone')
              : t('whatsapp.warmUpDay', { day: session.warmUpDay })}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-1 sm:col-span-2">
          <dt className="text-muted-foreground">{t('whatsapp.sent24h')}</dt>
          <dd>{t('whatsapp.ofCap', { count: session.sentLast24h, cap: session.dailyCap })}</dd>
          <dd className="w-full">
            <UsageBar value={session.sentLast24h} max={session.dailyCap} />
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">{t('whatsapp.firstContacts')}</dt>
          <dd>
            {t('whatsapp.ofCap', {
              count: session.firstContactsLast24h,
              cap: session.firstContactCap,
            })}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">{t('whatsapp.hourly')}</dt>
          <dd>{t('whatsapp.ofCap', { count: session.sentLastHour, cap: session.hourlyCap })}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2 sm:col-span-2">
          <dt className="text-muted-foreground">{t('whatsapp.lastConnected')}</dt>
          <dd>
            {session.lastConnectedAt
              ? formatDateTime(session.lastConnectedAt)
              : t('whatsapp.neverConnected')}
          </dd>
        </div>
      </dl>
      {(detailLink || (manager && session.state !== 'unlinked')) && (
        <div className="flex flex-wrap gap-2">
          {detailLink && (
            <Button
              variant="outline"
              size="sm"
              render={<Link to="/whatsapp/$sessionId" params={{ sessionId: session.id }} />}
            >
              {t('whatsapp.details')}
            </Button>
          )}
          {manager && session.state !== 'unlinked' && (
            <SessionActions
              session={session}
              disabled={disabled}
              onLink={onLink}
              onUnlinked={onUnlinked}
            />
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Today's sends against the cap, drawn; the numbers beside it are what screen readers hear. It
 * warms at 80% and turns red at the cap.
 */
function UsageBar({ value, max }: { value: number; max: number }) {
  // A number not linked yet has no cap: an empty bar.
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          'h-full rounded-full',
          share >= 1
            ? 'bg-destructive'
            : share >= 0.8
              ? 'bg-status-warning-foreground'
              : 'bg-primary',
        )}
        style={{ inlineSize: `${share * 100}%` }}
      />
    </div>
  );
}

/**
 * Pause (asks first) or resume, re-link (opens the link dialog) or continue a link in progress,
 * and unlink (asks first). Each change asks for a TOTP when the 5-minute window is closed.
 */
function SessionActions({
  session,
  disabled,
  onLink,
  onUnlinked,
}: {
  session: PlatformWhatsAppSession;
  disabled: boolean;
  onLink: (target: LinkTarget) => void;
  onUnlinked: (() => void) | undefined;
}) {
  const { t } = useTranslation('console');
  const errorText = useWhatsAppErrorText();
  const withReauth = useReauth();
  const changed = useWhatsAppSessionsChanged();
  const target = { id: session.id, label: session.label };
  const pausing = session.pausedAt === null;

  const pause = useMutation({
    mutationFn: () => withReauth(() => pauseWhatsAppSession(session.id, pausing)),
    onSuccess: async () => {
      toast.add({
        title: pausing ? t('whatsapp.pausedDone') : t('whatsapp.resumed'),
        type: 'success',
      });
      await changed();
    },
    onError: (error) => toast.add({ title: errorText(error), type: 'error' }),
  });
  const relink = useMutation({
    mutationFn: () => withReauth(() => relinkWhatsAppSession(session.id)),
    onSuccess: async () => {
      onLink(target);
      await changed();
    },
    onError: (error) => toast.add({ title: errorText(error), type: 'error' }),
  });
  const unlink = useMutation({
    mutationFn: () => withReauth(() => unlinkWhatsAppSession(session.id)),
    onSuccess: async () => {
      toast.add({ title: t('whatsapp.unlinked'), type: 'success' });
      onUnlinked?.();
      await changed();
    },
    onError: (error) => toast.add({ title: errorText(error), type: 'error' }),
  });

  return (
    <>
      {session.state === 'linking' && (
        <Button type="button" size="sm" disabled={disabled} onClick={() => onLink(target)}>
          {t('whatsapp.continueLinking')}
        </Button>
      )}
      {relinkable.has(session.state) && (
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          loading={relink.isPending}
          onClick={() => relink.mutate()}
        >
          {t('whatsapp.relink')}
        </Button>
      )}
      {pausing ? (
        <ConfirmDialog
          trigger={
            <DialogTrigger
              render={
                <Button variant="outline" size="sm" disabled={disabled} loading={pause.isPending} />
              }
            >
              {t('whatsapp.pause')}
            </DialogTrigger>
          }
          title={t('whatsapp.pauseDialog.title', { label: session.label })}
          description={t('whatsapp.pauseDialog.description')}
          confirm={t('whatsapp.pauseDialog.confirm')}
          onConfirm={() => pause.mutate()}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          loading={pause.isPending}
          onClick={() => pause.mutate()}
        >
          {t('whatsapp.resume')}
        </Button>
      )}
      <ConfirmDialog
        trigger={
          <DialogTrigger
            render={
              <Button variant="ghost" size="sm" disabled={disabled} loading={unlink.isPending} />
            }
          >
            {t('whatsapp.unlink')}
          </DialogTrigger>
        }
        title={t('whatsapp.unlinkDialog.title', { label: session.label })}
        description={t('whatsapp.unlinkDialog.description')}
        confirm={t('whatsapp.unlinkDialog.confirm')}
        onConfirm={() => unlink.mutate()}
      />
    </>
  );
}
