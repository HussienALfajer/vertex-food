import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Button, toast } from '@vertex-food/ui';
import { ArrowLeftRightIcon, LogOutIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, apiErrorCode, unwrapEmpty } from '../../lib/api';
import { useErrorText } from '../../lib/error-text';

const tenantCountKey = 'vertex-food.personal-tenant-count';

/**
 * How many restaurants the person could choose at sign-in (rule 34), so the shell offers the
 * switcher only to owners of several (edge case 2). A count, never an id or a name; per tab.
 */
export function rememberTenantCount(count: number): void {
  try {
    sessionStorage.setItem(tenantCountKey, String(count));
  } catch {
    // Storage blocked: the switcher stays hidden; signing out still leads to every restaurant.
  }
}

function tenantCount(): number {
  try {
    return Number(sessionStorage.getItem(tenantCountKey) ?? '1');
  } catch {
    return 1;
  }
}

/**
 * The personal-device shell's controls (spec S02 personal-device mode): sign out, and for owners
 * of several restaurants the switcher. Each switch is a new session (edge case 2): this one ends
 * and the sign-in leads to the tenant choice again (no OTP on a known device, rule 12).
 */
export function PersonalActions() {
  const { t } = useTranslation('restaurant');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);

  const leave = async (to: '/sign-in' | '/welcome') => {
    setBusy(true);
    try {
      await unwrapEmpty(api.POST('/api/sessions/current/end', { body: { reason: 'signed_out' } }));
    } catch (failure) {
      // The session cookie is `HttpOnly`: only the server ends it. Unless it says the session is
      // already gone, the person stays signed in and is told so (rule 35).
      if (!['UNAUTHENTICATED', 'SESSION_ENDED'].includes(apiErrorCode(failure) ?? '')) {
        setBusy(false);
        toast.add({ title: errorText(failure), type: 'error' });
        return;
      }
    }
    // Nothing of this restaurant stays in the cache for the next session.
    queryClient.clear();
    setBusy(false);
    await navigate({ to });
  };

  return (
    <>
      {tenantCount() > 1 && (
        <Button
          type="button"
          variant="secondary"
          aria-label={t('personal.switchTenant')}
          disabled={busy}
          onClick={() => void leave('/sign-in')}
        >
          <ArrowLeftRightIcon aria-hidden />
          <span className="max-sm:sr-only">{t('personal.switchTenant')}</span>
        </Button>
      )}
      <Button
        type="button"
        variant="secondary"
        aria-label={t('personal.signOut')}
        disabled={busy}
        onClick={() => void leave('/welcome')}
      >
        <LogOutIcon aria-hidden />
        <span className="max-sm:sr-only">{t('personal.signOut')}</span>
      </Button>
    </>
  );
}
