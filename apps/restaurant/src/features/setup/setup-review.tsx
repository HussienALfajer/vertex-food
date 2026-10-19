import { useQuery } from '@tanstack/react-query';
import { type BranchDetail, formatRateBp, isOvernight, type Tenant } from '@vertex-food/contracts';
import { Badge, Button, Callout } from '@vertex-food/ui';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { weekdayKey, weekdays } from '../tenancy/branch-draft';
import { formatCoordinates } from '../tenancy/location-fields';
import { citiesQuery } from '../tenancy/queries';
import { type SetupStep, stepOfItem } from './setup-steps';

/**
 * Step 5: the completeness list (rule 3) with a way to each missing item, then what was saved,
 * each part with "Edit" back to its step.
 */
export function SetupReview({
  tenant,
  details,
  onEdit,
}: {
  tenant: Tenant;
  details: BranchDetail[];
  onEdit: (step: SetupStep) => void;
}) {
  const { t } = useTranslation('restaurant');
  const cities = useQuery(citiesQuery);
  const several = details.length > 1;
  const list = (items: string[]) => items.join('، ');
  const branchName = (id: string | null) =>
    details.find((detail) => detail.branch.id === id)?.branch.nameAr;
  const cityName = (id: string | null) => {
    for (const governorate of cities.data ?? []) {
      const city = governorate.cities.find((item) => item.id === id);
      if (city) return list([city.nameAr, governorate.nameAr]);
    }
    return id ? t('fields.city.kept') : t('setup.review.notSet');
  };

  return (
    <div className="flex flex-col gap-4">
      {tenant.onboarding.missing.length === 0 ? (
        <Callout
          role="status"
          tone="info"
          icon={<CircleCheck aria-hidden />}
          title={t('setup.review.complete')}
        />
      ) : (
        <Callout
          role="status"
          tone="warning"
          icon={<TriangleAlert aria-hidden />}
          title={t('setup.review.missingTitle')}
          description={
            <span className="flex flex-col items-start gap-1">
              {tenant.onboarding.missing.map(({ item, branchId }) => {
                const name = several ? branchName(branchId) : undefined;
                const label = t(`setup.missing.${item}`);
                return (
                  <Button
                    key={`${item}-${branchId}`}
                    variant="link"
                    size="sm"
                    className="h-auto px-0 text-inherit underline"
                    onClick={() => onEdit(stepOfItem[item])}
                  >
                    {name ? t('setup.review.missingIn', { item: label, name }) : label}
                  </Button>
                );
              })}
            </span>
          }
        />
      )}
      <ReviewSection title={t('setup.steps.restaurant')} onEdit={() => onEdit('restaurant')}>
        <ReviewItem label={t('fields.nameAr.label')}>{tenant.nameAr}</ReviewItem>
        {tenant.nameLatin && (
          <ReviewItem label={t('fields.nameLatin.label')}>
            <span dir="ltr">{tenant.nameLatin}</span>
          </ReviewItem>
        )}
        <ReviewItem label={t('fields.logo.label')}>
          {tenant.logoFileId ? t('setup.review.added') : t('setup.review.notAdded')}
        </ReviewItem>
        <ReviewItem label={t('fields.cover.label')}>
          {tenant.coverFileId ? t('setup.review.added') : t('setup.review.notAdded')}
        </ReviewItem>
      </ReviewSection>
      {details.map(({ branch, hours, charges }) => (
        <ReviewSection
          key={branch.id}
          title={several ? branch.nameAr : t('setup.steps.location')}
          onEdit={() => onEdit('location')}
        >
          <ReviewItem label={t('fields.city.label')}>{cityName(branch.cityId)}</ReviewItem>
          <ReviewItem label={t('fields.address.label')}>
            {branch.addressDescription ?? t('setup.review.notSet')}
          </ReviewItem>
          <ReviewItem label={t('fields.location.label')}>
            {branch.location ? (
              <span dir="ltr">{formatCoordinates(branch.location)}</span>
            ) : (
              t('setup.review.notSet')
            )}
          </ReviewItem>
          <ReviewItem label={t('fields.phones.label')}>
            {branch.contactPhones.length === 0 ? (
              t('setup.review.notSet')
            ) : (
              <ul className="flex flex-col gap-1">
                {branch.contactPhones.map((entry) => (
                  <li key={entry.phone} className="flex items-center gap-2">
                    <span dir="ltr">{entry.phone}</span>
                    {entry.whatsapp && <Badge tone="success">{t('fields.phones.whatsapp')}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </ReviewItem>
          <ReviewItem label={t('fields.hours.label')}>
            {hours.length === 0 ? (
              t('setup.review.notSet')
            ) : (
              <ul className="flex flex-col gap-1">
                {weekdays.map((weekday) => {
                  const periods = hours.filter((period) => period.weekday === weekday);
                  return (
                    <li key={weekday}>
                      {t(`weekdays.${weekdayKey(weekday)}`)}:{' '}
                      {periods.length === 0
                        ? t('fields.hours.closed')
                        : list(
                            periods.map((period) =>
                              t(
                                isOvernight(period)
                                  ? 'setup.review.periodOvernight'
                                  : 'setup.review.period',
                                {
                                  opensAt: period.opensAt,
                                  closesAt: period.closesAt,
                                },
                              ),
                            ),
                          )}
                    </li>
                  );
                })}
              </ul>
            )}
          </ReviewItem>
          <ReviewItem label={t('fields.dayEnd.label')}>
            <span dir="ltr">{branch.businessDayEndsAt}</span>
          </ReviewItem>
          <ReviewItem label={t('fields.defaultCurrency.label')}>
            {t(`currencies.${branch.defaultCurrency}`)}
          </ReviewItem>
          <ReviewItem label={t('fields.acceptedCurrencies.label')}>
            {list(branch.acceptedCurrencies.map((code) => t(`currencies.${code}`)))}
          </ReviewItem>
          <ReviewItem label={t('fields.charges.label')}>
            {charges.length === 0
              ? t('fields.charges.empty')
              : list(
                  charges.map((charge) =>
                    t(`fields.charges.summary.${charge.mode}`, {
                      name: charge.nameAr,
                      rate: formatRateBp(charge.rateBp),
                      types: list(charge.orderTypes.map((type) => t(`orderTypes.${type}`))),
                    }),
                  ),
                )}
          </ReviewItem>
        </ReviewSection>
      ))}
    </div>
  );
}

function ReviewSection({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('restaurant');
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold">{title}</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          aria-label={t('setup.editStep', { step: title })}
        >
          {t('setup.edit')}
        </Button>
      </div>
      <dl className="grid gap-3 sm:grid-cols-[minmax(10rem,auto)_1fr]">{children}</dl>
    </section>
  );
}

function ReviewItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="wrap-anywhere">{children}</dd>
    </>
  );
}
