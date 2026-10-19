import { useTranslation } from 'react-i18next';
import { Pressable, Text } from 'react-native';
import { useColors } from '../lib/theme';
import { StateCard, stateButton } from './state-card';

/**
 * The screen of an unexpected error. It never shows or logs the error itself: its message may
 * carry customer data (ADR 0016).
 */
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <StateCard role="alert" title={t('errorTitle')} description={t('errorDescription')}>
      <Pressable
        role="button"
        onPress={onRetry}
        style={[stateButton, { backgroundColor: colors.accent }]}
      >
        <Text style={{ color: colors.onAccent }}>{t('retry')}</Text>
      </Pressable>
    </StateCard>
  );
}
