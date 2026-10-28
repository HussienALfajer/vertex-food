import { useTranslation } from 'react-i18next';
import { apiErrorCode } from '../../lib/api';
import { useErrorText } from '../../lib/error-text';

/**
 * A refusal of a number's action: a state that changed meanwhile and a label already taken have
 * texts about numbers (the shared codes' texts speak of restaurants and records); the rest as
 * everywhere (`useErrorText`).
 */
export function useWhatsAppErrorText(): (error: unknown) => string {
  const { t } = useTranslation('console');
  const errorText = useErrorText();
  return (error) => {
    const code = apiErrorCode(error);
    if (code === 'INVALID_STATUS_TRANSITION') return t('whatsapp.changedMeanwhile');
    if (code === 'CONFLICT') return t('whatsapp.linkDialog.labelTaken');
    return errorText(error);
  };
}
