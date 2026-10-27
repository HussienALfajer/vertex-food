import { isWeakPassword, passwordPolicy } from '@vertex-food/contracts';
import { CheckIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** What makes a password acceptable, as the API checks it (`passwordSchema`, `isWeakPassword`). */
export function passwordHints(password: string, phone: string) {
  return {
    length:
      password.length >= passwordPolicy.minLength && password.length <= passwordPolicy.maxLength,
    common: password.length > 0 && !isWeakPassword(password, phone),
  };
}

export function passwordAccepted(hints: { length: boolean; common: boolean }): boolean {
  return hints.length && hints.common;
}

/** The password rules as a checklist that follows the typing. */
export function PasswordHints({ hints }: { hints: { length: boolean; common: boolean } }) {
  const { t } = useTranslation('console');
  const items = [
    { met: hints.length, text: t('password.hintLength', { min: passwordPolicy.minLength }) },
    { met: hints.common, text: t('password.hintCommon') },
  ];
  return (
    <ul className="flex flex-col gap-1 text-sm" aria-live="polite">
      {items.map((item) => (
        <li
          key={item.text}
          className={
            item.met
              ? 'flex items-center gap-2 text-foreground'
              : 'flex items-center gap-2 text-muted-foreground'
          }
        >
          {item.met ? (
            <CheckIcon aria-hidden className="size-4 shrink-0 text-primary" />
          ) : (
            <XIcon aria-hidden className="size-4 shrink-0" />
          )}
          <span>
            <span className="sr-only">{item.met ? t('password.met') : t('password.notMet')}</span>
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
}
