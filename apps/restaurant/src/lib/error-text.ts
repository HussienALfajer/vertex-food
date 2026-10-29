import { limitKeySchema } from '@vertex-food/contracts';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ApiError, apiErrorCode } from './api';
import type { LimitReached } from './device';

/** The part of `ENTITLEMENT_LIMIT_REACHED`'s details the message names (spec S05 rule 21). */
const limitReachedSchema = z.object({ limit: limitKeySchema, value: z.int().min(0) });

/**
 * The Arabic text of a refusal, from its code (ADR 0020); anything without a code gets the generic
 * text. Never the error's own message, which may carry customer data (ADR 0016).
 */
export function useErrorText(): (error: unknown) => string {
  const { t } = useTranslation(['errors', 'restaurant', 'common', 'agreement']);
  return (error) => {
    // The password dialog of a sensitive action was closed (`features/session/reauth.tsx`).
    if (error instanceof Error && error.name === 'ReauthCancelled') {
      return t('restaurant:reauth.cancelled');
    }
    const code = apiErrorCode(error);
    if (code === 'NETWORK_ERROR') return t('restaurant:states.networkError');
    // An addition at one of the agreement's limits names it (spec S05 screen 3).
    const limit = code === 'ENTITLEMENT_LIMIT_REACHED' ? limitOf(error) : null;
    if (limit) {
      return t('agreement:refused.limit', {
        limit: t(`agreement:limits.${limit.limit}`),
        value: limit.value,
      });
    }
    if (code) return t(`errors:${code}`);
    return t('common:errorDescription');
  };
}

/** The limit and value an `ENTITLEMENT_LIMIT_REACHED` names, when they are known keys. */
function limitOf(error: unknown): LimitReached | null {
  const parsed = limitReachedSchema.safeParse(error instanceof ApiError ? error.details : null);
  return parsed.success ? { limit: parsed.data.limit, value: parsed.data.value } : null;
}
