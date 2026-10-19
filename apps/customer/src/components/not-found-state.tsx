import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '../lib/theme';
import { StateCard, stateButton } from './state-card';

export function NotFoundState() {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <StateCard title={t('notFoundTitle')} description={t('notFoundDescription')}>
      <Link
        href="/"
        style={[stateButton, { backgroundColor: colors.accent, color: colors.onAccent }]}
      >
        {t('goHome')}
      </Link>
    </StateCard>
  );
}
