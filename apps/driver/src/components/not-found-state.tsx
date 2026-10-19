import { Button } from '@vertex-food/ui-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StateCard } from './state-card';

export function NotFoundState() {
  const { t } = useTranslation();
  return (
    <StateCard title={t('notFoundTitle')} description={t('notFoundDescription')}>
      <Link href="/" asChild>
        <Button role="link" label={t('goHome')} />
      </Link>
    </StateCard>
  );
}
