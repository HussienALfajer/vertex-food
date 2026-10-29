import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@vertex-food/ui';
import {
  TriangleAlertIcon,
  CircleArrowUpIcon,
  CircleCheckIcon,
  CloudOffIcon,
  type LucideIcon,
  RefreshCwIcon,
  CloudUploadIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTime } from '../../lib/format';
import { can, useStaffAccess } from '../../lib/staff-access';
import type { SyncBridge, SyncStatusView } from '../../lib/sync';
import { attentionQuery, useSyncStatus } from './queries';
import { type ChipState, chipState, type RoleBadge, roleBadge } from './sync-state';

const chipIcons: Record<ChipState['kind'], LucideIcon> = {
  update: CircleArrowUpIcon,
  offline: CloudOffIcon,
  attention: TriangleAlertIcon,
  sending: CloudUploadIcon,
  connecting: RefreshCwIcon,
  synced: CircleCheckIcon,
};

const chipTones = {
  update: 'danger',
  offline: 'warning',
  attention: 'warning',
  sending: 'info',
  connecting: 'neutral',
  synced: 'success',
} as const;

/** The chip's text for a state (screen 1). */
export function useChipText(): (state: ChipState) => string {
  const { t } = useTranslation('sync');
  return (state) => {
    switch (state.kind) {
      case 'update':
        return t('chip.update');
      case 'offline':
        return state.since
          ? t('chip.offline', { time: formatTime(state.since), count: state.pending })
          : t('chip.offlineNever', { count: state.pending });
      case 'attention':
        return t('chip.attention', { count: state.count });
      case 'sending':
        return t('chip.sending', { count: state.pending });
      case 'connecting':
        return t('chip.connecting');
      case 'synced':
        return t('chip.synced', { time: formatTime(state.at) });
    }
  };
}

/** The open items the member sees (their own, or the branch's with the permission), online only. */
function useOpenAttention(branchId: string, online: boolean): number {
  const attention = useQuery({
    ...attentionQuery({ branchId, status: 'open', pageSize: 1 }),
    enabled: online,
    refetchInterval: 60_000,
  });
  return online ? (attention.data?.total ?? 0) : 0;
}

/**
 * The sync status in the header of every screen on a PC (spec S04 screen 1, ADR 0008): one chip
 * with an icon and text, the role badge beside it, and a sheet with the details on a tap. On a
 * phone-width window the chip keeps its icon only; its name carries the text.
 */
export function SyncChip({
  bridge,
  branchId,
  online,
}: {
  bridge: SyncBridge;
  branchId: string;
  /** The session has an access token: the attention count can be read. */
  online: boolean;
}) {
  const { t } = useTranslation('sync');
  const status = useSyncStatus(bridge);
  const openAttention = useOpenAttention(branchId, online);
  const chipText = useChipText();
  const [open, setOpen] = useState(false);
  const view = status.data;
  if (!view) return null;
  const state = chipState(view, openAttention);
  const badge = roleBadge(view);
  const Icon = chipIcons[state.kind];
  const text = chipText(state);
  return (
    <>
      {badge && <RoleBadges badge={badge} className="hidden md:flex" />}
      <Button
        type="button"
        variant="outline"
        aria-label={text}
        data-slot="sync-chip"
        data-state={state.kind}
        onClick={() => setOpen(true)}
        className="max-sm:size-11 max-sm:px-0"
      >
        <Badge tone={chipTones[state.kind]} className="size-6 justify-center px-0">
          <Icon aria-hidden />
        </Badge>
        <span className="max-sm:sr-only">{text}</span>
      </Button>
      <SyncSheet
        open={open}
        onOpenChange={setOpen}
        view={view}
        badge={badge}
        chipText={text}
        tone={chipTones[state.kind]}
      />
    </>
  );
}

function RoleBadges({ badge, className }: { badge: RoleBadge; className?: string }) {
  const { t } = useTranslation('sync');
  return (
    <span className={`flex-wrap items-center gap-1 ${className ?? 'flex'}`}>
      <Badge tone="brand">{t(`liveRoles.${badge.role}`)}</Badge>
      {badge.standbyNotInSync && <Badge tone="warning">{t('chip.standbyNotInSync')}</Badge>}
    </span>
  );
}

function SyncSheet({
  open,
  onOpenChange,
  view,
  badge,
  chipText,
  tone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: SyncStatusView;
  badge: RoleBadge | null;
  chipText: string;
  tone: (typeof chipTones)[ChipState['kind']];
}) {
  const { t } = useTranslation('sync');
  const access = useStaffAccess();
  const { sync, hub } = view;
  const hubStatus = hub?.status ?? null;
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t('sheet.title')}</DialogTitle>
        <DialogDescription>{t('sheet.description')}</DialogDescription>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone}>{chipText}</Badge>
          {badge && <RoleBadges badge={badge} />}
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Row label={t('sheet.lastSync')}>
            {sync.lastSyncedAt ? formatTime(sync.lastSyncedAt) : t('sheet.never')}
          </Row>
          <Row label={t('sheet.lastHeartbeat')}>
            {sync.lastHeartbeatAt ? formatTime(sync.lastHeartbeatAt) : t('sheet.never')}
          </Row>
          <Row label={t('sheet.pending')}>{sync.pendingUploads ?? t('sheet.unknown')}</Row>
          <Row label={t('sheet.connectivity')}>
            {sync.connectivity ? t(`connectivity.${sync.connectivity}`) : t('sheet.unknown')}
          </Row>
          {hubStatus && (
            <Row label={t('sheet.role')}>
              {t('sheet.roleValue', {
                role: t(`liveRoles.${badge?.role ?? hubStatus.role}`),
                epoch: hubStatus.epoch,
              })}
            </Row>
          )}
          {hubStatus?.role === 'hub' && (
            <Row label={t('sheet.standby')}>{t(`sheet.standbyStates.${hubStatus.standby}`)}</Row>
          )}
          {hub && (
            <Row label={t('sheet.outbox')}>
              {t('sheet.outboxValue', {
                sending: hub.outbox.sending,
                unmirrored: hub.outbox.unmirrored,
              })}
            </Row>
          )}
        </dl>
        {hubStatus && hubStatus.missing > 0 && hubStatus.role !== 'hub' && (
          <p className="text-sm text-muted-foreground">
            {t('sheet.missing', { count: hubStatus.missing })}
          </p>
        )}
        <DialogActions>
          <Button render={<Link to="/attention" />} onClick={close}>
            {t('nav.attention')}
          </Button>
          {can(access, 'hub.manage') && (
            <Button
              variant="secondary"
              render={<Link to="/settings/branch-network" />}
             
              onClick={close}
            >
              {t('nav.branchNetwork')}
            </Button>
          )}
          <DialogClose render={<Button type="button" variant="ghost" />}>
            {t('sheet.close')}
          </DialogClose>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="wrap-anywhere text-foreground">{children}</dd>
    </div>
  );
}
