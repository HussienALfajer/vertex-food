import { useQuery } from '@tanstack/react-query';
import {
  formatAmount,
  type Money,
  type TenantAgreement,
  type TermValues,
} from '@vertex-food/contracts';
import {
  Badge,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  PageHeader,
} from '@vertex-food/ui';
import { CalendarClockIcon, FileTextIcon, WifiOffIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NotFoundState } from '../../components/not-found-state';
import { QueryStates } from '../../components/query-states';
import { formatDate, formatDateTime, formatDay } from '../../lib/format';
import { useOnline } from '../../lib/online';
import { can, useStaffAccess } from '../../lib/staff-access';
import { syncBridge } from '../../lib/sync';
import {
  type FeatureView,
  formatPercentBp,
  type LimitView,
  limitView,
  offlineView,
  shownFeatures,
} from './agreement-view';
import { tenantAgreementQuery, useBranchEntitlements } from './queries';

/**
 * `/settings/agreement` (spec S05 screen 1, `agreement.view`, the owner): what the restaurant's
 * agreement with Vertex holds, read only (rule 28). Online from the API; offline, the features
 * and limits of the PC's copy as last synced, never money.
 */
export function AgreementScreen() {
  const { t } = useTranslation('agreement');
  const access = useStaffAccess();
  const online = useOnline();
  const allowed = can(access, 'agreement.view');
  const agreement = useQuery({ ...tenantAgreementQuery, enabled: allowed && online });
  if (!allowed) return <NotFoundState />;
  return (
    <section className="flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title={t('page.title')} description={t('page.description')} />
      {online ? (
        <QueryStates queries={[agreement]}>
          {() => <AgreementSections agreement={agreement.data as TenantAgreement} />}
        </QueryStates>
      ) : (
        <OfflineAgreement />
      )}
    </section>
  );
}

function AgreementSections({ agreement }: { agreement: TenantAgreement }) {
  const { t } = useTranslation('agreement');
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Section title={t('page.featuresTitle')}>
        <ul className="flex flex-col divide-y divide-border">
          {shownFeatures(agreement.features).map((feature) => (
            <FeatureRow key={feature.key} feature={feature} />
          ))}
        </ul>
      </Section>
      <Section title={t('page.limitsTitle')}>
        <ul className="flex flex-col gap-4">
          {agreement.limits.map((limit) => (
            <LimitRow key={limit.key} limit={limitView(limit)} />
          ))}
        </ul>
      </Section>
      <Section title={t('page.chargesTitle')} wide>
        {agreement.charges.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('page.emptyCharges')}</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {agreement.charges.map((charge) => (
              <ChargeCard key={charge.id} charge={charge} />
            ))}
          </ul>
        )}
      </Section>
      {agreement.oneOffFees.length > 0 && (
        <Section title={t('page.oneOffTitle')}>
          <ul className="flex flex-col divide-y divide-border">
            {agreement.oneOffFees.map((fee) => (
              <OneOffRow key={fee.id} fee={fee} />
            ))}
          </ul>
        </Section>
      )}
      <Section title={t('page.historyTitle')}>
        {agreement.amendments.length === 0 ? (
          <EmptyState icon={<FileTextIcon />} title={t('page.emptyHistory')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {[...agreement.amendments].reverse().map((amendment) => (
              <li key={amendment.number} className="text-sm">
                {t('page.amendment', {
                  number: amendment.number,
                  date: formatDateTime(amendment.approvedAt),
                })}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  wide = false,
  children,
}: {
  title: string;
  /** Across both columns from `md`. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className={cn('min-w-0', wide && 'md:col-span-2')}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      {children}
    </Card>
  );
}

function FeatureRow({ feature }: { feature: FeatureView }) {
  const { t } = useTranslation('agreement');
  const { source } = feature;
  const sourceText =
    source.kind === 'trial'
      ? t('sources.trial', { date: formatDateTime(source.until) })
      : source.kind === 'off'
        ? null
        : t(`sources.${source.kind}`);
  return (
    <li className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0" data-feature={feature.key}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-medium">{t(`features.${feature.key}`)}</span>
        <Badge tone={feature.on ? 'success' : 'neutral'}>
          {feature.on ? t('page.on') : t('sources.off')}
        </Badge>
      </div>
      {sourceText && <span className="text-sm text-muted-foreground">{sourceText}</span>}
      {feature.stopsAt && <StopsAt at={feature.stopsAt} />}
    </li>
  );
}

function StopsAt({ at }: { at: string }) {
  const { t } = useTranslation('agreement');
  return (
    <span className="flex items-center gap-1.5 text-sm font-medium text-status-warning-foreground">
      <CalendarClockIcon aria-hidden className="size-4 shrink-0" />
      {t('page.stopsAt', { date: formatDateTime(at) })}
    </span>
  );
}

function LimitRow({ limit }: { limit: LimitView }) {
  const { t } = useTranslation('agreement');
  return (
    <li className="flex flex-col gap-2" data-limit={limit.key}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-medium">{t(`limits.${limit.key}`)}</span>
        <span
          dir="ltr"
          className={cn('text-sm', limit.over && 'font-bold text-status-warning-foreground')}
        >
          {limit.value === null
            ? t('page.unlimited')
            : t('page.usage', { usage: limit.usage, value: limit.value })}
        </span>
      </div>
      {limit.value !== null && (
        // The numbers beside it are what screen readers hear.
        <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full',
              limit.share >= 1 ? 'bg-status-warning-foreground' : 'bg-primary',
            )}
            style={{ inlineSize: `${limit.share * 100}%` }}
          />
        </div>
      )}
      {limit.over && <span className="text-sm text-muted-foreground">{t('page.overLimit')}</span>}
    </li>
  );
}

/** An amount with its currency's code, never summed across currencies (ADR 0014). */
function useMoney(): (money: Money) => string {
  const { t } = useTranslation('agreement');
  return (money) => t('charges.amount', { amount: formatAmount(money), currency: money.currency });
}

/** The lines of a money term (rule 28): amount and period, channel and percentage, or a waiver. */
function useTermLines(): (values: TermValues) => string[] {
  const { t } = useTranslation('agreement');
  const money = useMoney();
  return (values) => {
    switch (values.kind) {
      case 'subscription':
      case 'listing_fee':
        return [
          `${money(values)} ${t(`charges.${values.period}`)}`,
          t(values.per === 'active_branch' ? 'charges.perBranch' : 'charges.perTenant'),
        ];
      case 'commission':
        return [
          t(`charges.channels.${values.channel}`),
          ...(values.percentBp > 0
            ? [t('charges.percent', { percent: formatPercentBp(values.percentBp) })]
            : []),
          ...(values.fixed && values.fixed.amount > 0
            ? [t('charges.fixed', { amount: money(values.fixed) })]
            : []),
        ];
      case 'delivery_fee_share':
        return [t('charges.deliveryShare', { percent: formatPercentBp(values.percentBp) })];
      case 'waiver':
        return [
          values.waives.kind === 'commission'
            ? t('charges.waives.commission', {
                channel: t(`charges.channels.${values.waives.channel}`),
              })
            : t(`charges.waives.${values.waives.kind}`),
        ];
      case 'setup_fee':
      case 'hardware':
      case 'service':
        return [values.label, money(values)];
      default:
        // Features and limits are not charges.
        return [];
    }
  };
}

/** What a charge or fee is called: its kind, never a feature or limit term. */
type ChargeKind = Exclude<TermValues['kind'], 'feature' | 'limit'>;

function chargeKind(values: TermValues): ChargeKind {
  return values.kind as ChargeKind;
}

function ChargeCard({ charge }: { charge: TenantAgreement['charges'][number] }) {
  const { t } = useTranslation('agreement');
  const lines = useTermLines()(charge.values);
  return (
    <li
      className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-4"
      data-charge={charge.values.kind}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{t(`charges.${chargeKind(charge.values)}`)}</span>
        <Badge tone={charge.state === 'in_force' ? 'success' : 'info'}>
          {charge.state === 'in_force' ? t('page.inForce') : t('page.scheduled')}
        </Badge>
      </div>
      {lines.map((line) => (
        <span key={line} className="text-sm">
          {line}
        </span>
      ))}
      <span className="text-sm text-muted-foreground">
        {t('page.from', { date: formatDay(charge.effectiveFrom) })}
        {charge.endsAt && ` · ${t('page.until', { date: formatDay(charge.endsAt) })}`}
      </span>
    </li>
  );
}

function OneOffRow({ fee }: { fee: TenantAgreement['oneOffFees'][number] }) {
  const { t } = useTranslation('agreement');
  const lines = useTermLines()(fee.values);
  return (
    <li className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-medium">{lines[0]}</span>
        <span className="text-sm">{lines[1]}</span>
      </div>
      <span className="text-sm text-muted-foreground">
        {t(`charges.${chargeKind(fee.values)}`)} ·{' '}
        {t('page.dueOn', { date: formatDate(fee.dueOn) })}
      </span>
    </li>
  );
}

/**
 * Offline (screen 1): the page needs the internet. On a PC the copy's features and limits as last
 * synced stand beneath, without usage or money; a browser has no copy.
 */
function OfflineAgreement() {
  const { t } = useTranslation('agreement');
  const entitlements = useBranchEntitlements(syncBridge);
  const copy = entitlements.data?.copy ?? null;
  const view = copy ? offlineView(copy, new Date()) : null;
  return (
    <>
      <Card role="status">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <WifiOffIcon aria-hidden className="size-5 shrink-0" />
            {t('page.offline')}
          </CardTitle>
          {syncBridge && (
            <CardDescription>
              {view ? t('page.offlineHint') : t('page.neverSynced')}
              {entitlements.data?.lastSyncedAt &&
                ` ${t('page.lastSynced', { date: formatDateTime(entitlements.data.lastSyncedAt) })}`}
            </CardDescription>
          )}
        </CardHeader>
      </Card>
      {view && (
        <div className="grid gap-6 md:grid-cols-2">
          <Section title={t('page.featuresTitle')}>
            <ul className="flex flex-col divide-y divide-border">
              {view.features.map((feature) => (
                <li
                  key={feature.key}
                  className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
                  data-feature={feature.key}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 font-medium">{t(`features.${feature.key}`)}</span>
                    <Badge tone="success">{t('page.on')}</Badge>
                  </div>
                  {feature.stopsAt && <StopsAt at={feature.stopsAt} />}
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('page.limitsTitle')}>
            <ul className="flex flex-col divide-y divide-border">
              {view.limits.map((limit) => (
                <li
                  key={limit.key}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                  data-limit={limit.key}
                >
                  <span className="min-w-0 font-medium">{t(`limits.${limit.key}`)}</span>
                  <span dir="ltr" className="text-sm">
                    {limit.value === null ? t('page.unlimited') : limit.value}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </>
  );
}
