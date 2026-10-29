import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { QuarantineBatch } from '@vertex-food/contracts';
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
  EmptyState,
  PageHeader,
  toast,
} from '@vertex-food/ui';
import { ShieldCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotFoundState } from '../../components/not-found-state';
import { OfflineNotice } from '../../components/offline-notice';
import { QueryStates } from '../../components/query-states';
import { apiErrorCode } from '../../lib/api';
import { useErrorText } from '../../lib/error-text';
import { formatDateTime } from '../../lib/format';
import { useOnline } from '../../lib/online';
import { can, useStaffAccess } from '../../lib/staff-access';
import { isReauthCancelled, useSensitive } from '../session/reauth';
import {
  acceptQuarantine,
  quarantineBatchQuery,
  quarantineQuery,
  rejectQuarantine,
} from './queries';
import { Detail, ReasonDialog, useCommandSummary, useMemberNames } from './sync-parts';

/**
 * `/settings/quarantine` (spec S04 screen 4, rules 40–42, owner): the batches of a revoked PC or of
 * a member deactivated during a cut, which never run until the owner decides. Online only.
 */
export function QuarantineScreen() {
  const { t } = useTranslation('sync');
  const access = useStaffAccess();
  const batches = useQuery(quarantineQuery);
  if (!can(access, 'sync.quarantine.review')) return <NotFoundState />;
  return (
    <section className="flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title={t('quarantine.title')} description={t('quarantine.description')} />
      <OfflineNotice />
      <QueryStates queries={[batches]}>
        {() => {
          const list = batches.data ?? [];
          if (list.length === 0) {
            return <EmptyState icon={<ShieldCheckIcon />} title={t('quarantine.empty')} />;
          }
          return (
            <ul className="flex flex-col gap-3" aria-label={t('quarantine.title')}>
              {list.map((batch) => (
                <li key={batch.id}>
                  <Card className="gap-3 p-4">
                    <BatchSummary batch={batch} />
                    <Button
                      variant="secondary"
                      className="self-start"
                      render={
                        <Link to="/settings/quarantine/$batchId" params={{ batchId: batch.id }} />
                      }
                    >
                      {t('quarantine.open')}
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryStates>
    </section>
  );
}

function BatchSummary({ batch }: { batch: QuarantineBatch }) {
  const { t } = useTranslation('sync');
  const memberName = useMemberNames();
  const decision = batch.decision;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold wrap-anywhere">{batch.deviceName}</span>
        {decision === null ? (
          <Badge tone="warning">{t('quarantine.pendingDecision')}</Badge>
        ) : decision.decision === 'accept' ? (
          <Badge tone="success">{t('quarantine.accepted')}</Badge>
        ) : (
          <Badge tone="danger">{t('quarantine.rejected')}</Badge>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {batch.membershipId && (
          <Detail label={t('quarantine.member')}>{memberName(batch.membershipId)}</Detail>
        )}
        <Detail label={t('quarantine.reason')}>{t(`quarantineReasons.${batch.reason}`)}</Detail>
        <Detail label={t('quarantine.count')}>{batch.commandCount}</Detail>
        <Detail label={t('quarantine.receivedAt')}>{formatDateTime(batch.createdAt)}</Detail>
        {decision?.reason && (
          <Detail label={t('quarantine.decisionReason')}>{decision.reason}</Detail>
        )}
      </dl>
    </>
  );
}

/** `/settings/quarantine/$batchId`: the batch's commands, accepted or rejected after re-auth. */
export function QuarantineBatchScreen({ batchId }: { batchId: string }) {
  const { t } = useTranslation('sync');
  const access = useStaffAccess();
  const online = useOnline();
  const summary = useCommandSummary();
  const detail = useQuery(quarantineBatchQuery(batchId));
  const [deciding, setDeciding] = useState<'accept' | 'reject' | null>(null);
  if (!can(access, 'sync.quarantine.review')) return <NotFoundState />;
  if (apiErrorCode(detail.error) === 'NOT_FOUND') return <NotFoundState />;
  return (
    <section className="flex w-full max-w-3xl flex-col gap-6">
      <Button variant="ghost" className="self-start" render={<Link to="/settings/quarantine" />}>
        {t('quarantine.back')}
      </Button>
      <QueryStates queries={[detail]}>
        {() => {
          const loaded = detail.data;
          if (!loaded) return null;
          const { batch, commands } = loaded;
          return (
            <>
              <PageHeader title={t('quarantine.detailTitle', { name: batch.deviceName })} />
              <OfflineNotice />
              <Card className="gap-3 p-4">
                <BatchSummary batch={batch} />
              </Card>
              <h2 className="text-lg font-bold">{t('quarantine.commands')}</h2>
              <ul className="flex flex-col gap-2" aria-label={t('quarantine.commands')}>
                {commands.map((command) => (
                  <li key={command.commandId}>
                    <Card className="gap-2 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium wrap-anywhere">
                          {summary(command.summary, command.name)}
                        </span>
                        {command.alreadyExecuted && (
                          <Badge tone="info">{t('quarantine.alreadyExecuted')}</Badge>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {t('quarantine.deviceTime')}: {formatDateTime(command.deviceTime)}
                      </span>
                    </Card>
                  </li>
                ))}
              </ul>
              {batch.decision === null && (
                <div className="flex flex-wrap gap-3">
                  <Button type="button" disabled={!online} onClick={() => setDeciding('accept')}>
                    {t('quarantine.accept')}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!online}
                    onClick={() => setDeciding('reject')}
                  >
                    {t('quarantine.reject')}
                  </Button>
                </div>
              )}
            </>
          );
        }}
      </QueryStates>
      {deciding === 'accept' && (
        <AcceptDialog batchId={batchId} onClose={() => setDeciding(null)} />
      )}
      {deciding === 'reject' && (
        <RejectDialog batchId={batchId} onClose={() => setDeciding(null)} />
      )}
    </section>
  );
}

function useDecided() {
  const { t } = useTranslation('sync');
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['quarantine'] });
    toast.add({ title: t('quarantine.decided'), type: 'success' });
  };
}

function AcceptDialog({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const { t } = useTranslation('sync');
  const sensitive = useSensitive();
  const errorText = useErrorText();
  const decided = useDecided();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent>
        <DialogTitle>{t('quarantine.acceptTitle')}</DialogTitle>
        <DialogDescription>{t('quarantine.acceptDescription')}</DialogDescription>
        {error && <Callout role="alert" tone="danger" title={error} />}
        <DialogActions>
          <Button
            type="button"
            loading={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              void sensitive(() => acceptQuarantine(batchId))
                .then(decided)
                .then(onClose)
                .catch((failure: unknown) => {
                  if (!isReauthCancelled(failure)) setError(errorText(failure));
                })
                .finally(() => setBusy(false));
            }}
          >
            {t('quarantine.accept')}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {t('quarantine.cancel')}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const { t } = useTranslation('sync');
  const sensitive = useSensitive();
  const decided = useDecided();
  return (
    <ReasonDialog
      title={t('quarantine.rejectTitle')}
      description={t('quarantine.rejectDescription')}
      label={t('quarantine.decisionReason')}
      invalidText={t('quarantine.rejectReasonInvalid')}
      action={t('quarantine.reject')}
      destructive
      cancelLabel={t('quarantine.cancel')}
      submit={async (reason) => {
        await sensitive(() => rejectQuarantine(batchId, reason));
        await decided();
      }}
      onClose={onClose}
    />
  );
}
