import type { UseQueryResult } from '@tanstack/react-query';
import { Skeleton } from '@vertex-food/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrorText } from '../lib/error-text';
import { useOnline } from '../lib/online';
import { ErrorState } from './error-state';
import { StateCard } from './state-card';

/** The loading state of a screen: the shape of a form, announced to screen readers. */
export function LoadingState() {
  const { t } = useTranslation('restaurant');
  return (
    <section aria-busy="true" className="flex max-w-3xl flex-col gap-4">
      <span className="sr-only">{t('states.loading')}</span>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </section>
  );
}

/** An online-only screen without its data while the device is offline (S01). */
export function OfflineState() {
  const { t } = useTranslation('restaurant');
  return (
    <StateCard
      role="status"
      title={t('states.offlineTitle')}
      description={t('states.offlineDescription')}
    />
  );
}

/**
 * The states of an online-only screen before its data is there: loading, offline (queries pause
 * while offline, nothing is queued) or error with a retry. Renders `children` once every query has
 * its data, and keeps them when a later refetch fails or the connection drops: the last loaded
 * values stay on screen, read-only while offline.
 */
export function QueryStates({
  queries,
  children,
}: {
  queries: readonly UseQueryResult[];
  children: () => ReactNode;
}) {
  const online = useOnline();
  const errorText = useErrorText();
  const failed = queries.find((query) => query.isLoadingError);
  if (failed) {
    return (
      <ErrorState
        description={errorText(failed.error)}
        onRetry={() => {
          for (const query of queries) if (query.isLoadingError) void query.refetch();
        }}
      />
    );
  }
  if (queries.some((query) => query.isPending)) return online ? <LoadingState /> : <OfflineState />;
  return children();
}
