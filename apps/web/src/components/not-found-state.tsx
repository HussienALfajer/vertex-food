import { Button } from '@vertex-food/ui';
import Link from 'next/link';
import { i18n } from '../lib/i18n';
import { StateCard } from './state-card';

export function NotFoundState() {
  const { t } = i18n;
  return (
    <StateCard
      title={t('notFoundTitle')}
      description={t('notFoundDescription')}
      action={<Button render={<Link href="/" />}>{t('goHome')}</Button>}
    />
  );
}
