import { Link } from '@tanstack/react-router';
import { Button } from '@vertex-food/ui';
import { useTranslation } from 'react-i18next';
import { StateCard } from './state-card';

export function NotFoundState() {
  const { t } = useTranslation();
  return (
    <StateCard
      title={t('notFoundTitle')}
      description={t('notFoundDescription')}
      action={<Button render={<Link to="/" />}>{t('goHome')}</Button>}
    />
  );
}
