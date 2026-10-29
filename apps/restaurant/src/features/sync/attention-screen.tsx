import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AttentionItem,
  type AttentionKind,
  attentionKindSchema,
  type Branch,
  PAGE_SIZE_MAX,
} from '@vertex-food/contracts';
import { Badge, Button, Callout, Card, EmptyState, PageHeader, toast } from '@vertex-food/ui';
import { CircleCheckIcon, WifiOffIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryStates } from '../../components/query-states';
import { type DeviceBridge, deviceBridge } from '../../lib/device';
import { formatDateTime } from '../../lib/format';
import { useOnline } from '../../lib/online';
import { can, useStaffAccess } from '../../lib/staff-access';
import { type CommandResultView, type SyncBridge, syncBridge } from '../../lib/sync';
import { deviceStatusQuery, useMe } from '../session/queries';
import { branchesQuery } from '../tenancy/queries';
import { attentionQuery, resolveAttention, syncResultsQuery, useSyncChanges } from './queries';
import {
  ChoiceField,
  Detail,
  ReasonDialog,
  useCommandSummary,
  useMemberNames,
  useOutcomeText,
} from './sync-parts';
import { localAttention } from './sync-state';

type Status = 'open' | 'closed' | 'all';

const PAGE = 50;

/** The member of this PC's PIN session (`useMe()` is null in a session opened offline). */
function useSessionMember(): string | null {
  const me = useMe();
  const device = useQuery({
    ...deviceStatusQuery(deviceBridge as DeviceBridge),
    enabled: deviceBridge !== null,
  });
  if (device.data?.state === 'registered') return device.data.session?.membershipId ?? null;
  return me?.membershipId ?? null;
}

/** The branch whose items are listed: this PC's, or in a browser the one chosen of the scope. */
function useBranchChoice(): {
  branchId: string | null;
  branches: Branch[];
  choose: (id: string) => void;
} {
  const device = useQuery({
    ...deviceStatusQuery(deviceBridge as DeviceBridge),
    enabled: deviceBridge !== null,
  });
  const branches = useQuery({ ...branchesQuery, enabled: deviceBridge === null });
  const [chosen, setChosen] = useState<string | null>(null);
  if (deviceBridge) {
    const status = device.data;
    return {
      branchId: status?.state === 'registered' ? status.branch.id : null,
      branches: [],
      choose: () => undefined,
    };
  }
  const list = branches.data ?? [];
  return { branchId: chosen ?? list[0]?.id ?? null, branches: list, choose: setChosen };
}

/**
 * `/attention` (spec S04 screen 3, rule 47): the commands the server adjusted or rejected, or
 * flagged, with their time, kind, summary, maker and reason; filters by kind and open or closed.
 * Members with `sync.attention.resolve` see the branch's items and close one online with a reason;
 * anyone else sees their own (the API decides). Offline, a PC lists its own results instead,
 * the member's own unless they hold the permission.
 */
export function AttentionScreen() {
  const { t } = useTranslation('sync');
  const access = useStaffAccess();
  const online = useOnline();
  const { branchId, branches, choose } = useBranchChoice();
  const [status, setStatus] = useState<Status>('open');
  const [kind, setKind] = useState<AttentionKind | 'all'>('all');
  const [pageSize, setPageSize] = useState(PAGE);
  const sessionMember = useSessionMember();
  const manager = can(access, 'sync.attention.resolve', branchId ?? undefined);
  const attention = useQuery({
    ...attentionQuery({
      branchId: branchId ?? '',
      status,
      kind: kind === 'all' ? undefined : kind,
      pageSize,
    }),
    enabled: branchId !== null,
  });
  return (
    <section className="flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title={t('attention.title')}
        description={manager ? t('attention.description') : t('attention.ownDescription')}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {branches.length > 1 && (
          <ChoiceField
            label={t('attention.branch')}
            value={branchId}
            onChange={choose}
            choices={branches.map((branch) => ({ value: branch.id, label: branch.nameAr }))}
          />
        )}
        <ChoiceField<Status>
          label={t('attention.status')}
          value={status}
          onChange={setStatus}
          choices={(['open', 'closed', 'all'] as const).map((value) => ({
            value,
            label: t(`attention.statuses.${value}`),
          }))}
        />
        <ChoiceField<AttentionKind | 'all'>
          label={t('attention.kind')}
          value={kind}
          onChange={setKind}
          choices={[
            { value: 'all', label: t('attention.allKinds') },
            ...attentionKindSchema.options.map((value) => ({
              value,
              label: t(`attentionKinds.${value}`),
            })),
          ]}
        />
      </div>
      {!online && !attention.data && syncBridge ? (
        <LocalAttention
          bridge={syncBridge}
          scope={manager ? { all: true } : { membershipId: sessionMember }}
        />
      ) : (
        <QueryStates queries={[attention]}>
          {() => {
            const page = attention.data;
            if (!page || page.items.length === 0) {
              return <EmptyState icon={<CircleCheckIcon />} title={t('attention.empty')} />;
            }
            return (
              <>
                <ul className="flex flex-col gap-3" aria-label={t('attention.title')}>
                  {page.items.map((item) => (
                    <AttentionRow key={item.id} item={item} canClose={manager} />
                  ))}
                </ul>
                {page.total > page.items.length && pageSize < PAGE_SIZE_MAX && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="self-start"
                    onClick={() => setPageSize(Math.min(PAGE_SIZE_MAX, pageSize + PAGE))}
                  >
                    {t('attention.more')}
                  </Button>
                )}
              </>
            );
          }}
        </QueryStates>
      )}
    </section>
  );
}

function AttentionRow({ item, canClose }: { item: AttentionItem; canClose: boolean }) {
  const { t } = useTranslation('sync');
  const online = useOnline();
  const summary = useCommandSummary();
  const memberName = useMemberNames();
  const queryClient = useQueryClient();
  const [closing, setClosing] = useState(false);
  const { command } = item;
  return (
    <li>
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold wrap-anywhere">{summary(command.summary, command.name)}</span>
          <Badge tone={item.resolution ? 'neutral' : 'warning'}>
            {t(`attentionKinds.${item.kind}`)}
          </Badge>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Detail label={t('attention.at')}>{formatDateTime(item.createdAt)}</Detail>
          <Detail label={t('attention.madeBy')}>{memberName(item.membershipId)}</Detail>
          <Detail label={t('attention.outcome')}>{t(`outcomes.${command.outcome}`)}</Detail>
          {command.reason && (
            <Detail label={t('attention.reason')}>{t(`reasons.${command.reason}`)}</Detail>
          )}
        </dl>
        {item.resolution && (
          <p className="text-sm text-muted-foreground wrap-anywhere">
            {t('attention.closedBy', { reason: item.resolution.reason })}
          </p>
        )}
        {canClose && !item.resolution && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={!online}
              onClick={() => setClosing(true)}
            >
              {t('attention.close')}
            </Button>
            {!online && <span className="text-sm text-muted-foreground">{t('needsOnline')}</span>}
          </div>
        )}
      </Card>
      {closing && (
        <ReasonDialog
          title={t('attention.closeTitle')}
          description={t('attention.closeDescription')}
          label={t('attention.closeReason')}
          invalidText={t('attention.closeReasonInvalid')}
          action={t('attention.close')}
          cancelLabel={t('network.cancel')}
          submit={async (reason) => {
            await resolveAttention(item.id, reason);
            await queryClient.invalidateQueries({ queryKey: ['attention'] });
            toast.add({ title: t('attention.closed'), type: 'success' });
          }}
          onClose={() => setClosing(false)}
        />
      )}
    </li>
  );
}

/** Offline on a PC: this PC's commands needing attention (`command_results`, `localAttention`). */
function LocalAttention({
  bridge,
  scope,
}: {
  bridge: SyncBridge;
  scope: Parameters<typeof localAttention>[1];
}) {
  const { t, i18n } = useTranslation('sync');
  useSyncChanges(bridge);
  const results = useQuery(syncResultsQuery(bridge));
  const summary = useCommandSummary();
  const memberName = useMemberNames();
  const outcomeText = useOutcomeText();
  const items = localAttention(results.data ?? [], scope);
  return (
    <>
      <Callout
        role="status"
        tone="warning"
        icon={<WifiOffIcon aria-hidden />}
        title={t('attention.offlineTitle')}
        description={t('attention.offline')}
      />
      {items.length === 0 ? (
        <EmptyState icon={<CircleCheckIcon />} title={t('attention.offlineEmpty')} />
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('attention.offlineTitle')}>
          {items.map((item: CommandResultView) => (
            <li key={item.id}>
              <Card className="gap-3 p-4">
                <span className="font-bold wrap-anywhere">{summary(null, item.name)}</span>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {item.madeAt && (
                    <Detail label={t('attention.at')}>{formatDateTime(item.madeAt)}</Detail>
                  )}
                  <Detail label={t('attention.madeBy')}>{memberName(item.membershipId)}</Detail>
                  {item.outcome && (
                    <Detail label={t('attention.outcome')}>{outcomeText(item.outcome)}</Detail>
                  )}
                  {item.reason && i18n.exists(`reasons.${item.reason}`, { ns: 'sync' }) && (
                    <Detail label={t('attention.reason')}>
                      {t(`reasons.${item.reason as 'payload_invalid'}`)}
                    </Detail>
                  )}
                </dl>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
