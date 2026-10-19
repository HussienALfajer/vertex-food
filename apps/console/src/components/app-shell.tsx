import { Link } from '@tanstack/react-router';
import { AppLayout, PoweredBy, sidebarLinkClassName, ThemeToggle } from '@vertex-food/ui';
import { HouseIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The frame of every screen (`AppLayout`, Vertex Hub's shell): the sidebar from 1024 px, a sheet
 * behind the menu button below. "Powered by Vertex Food" is always visible (ADR 0018).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['common', 'console']);
  return (
    <AppLayout
      productName={t('productName')}
      productLabel={t('console:productLabel')}
      labels={{
        skip: t('shell.skip'),
        navigation: t('console:nav.label'),
        openNavigation: t('shell.openNavigation'),
      }}
      navigation={(close) => (
        <Link
          to="/"
          onClick={close}
          activeOptions={{ exact: true }}
          className={sidebarLinkClassName}
        >
          <HouseIcon aria-hidden />
          {t('console:nav.home')}
        </Link>
      )}
      actions={<ThemeToggle labels={{ toDark: t('theme.toDark'), toLight: t('theme.toLight') }} />}
      footer={<PoweredBy label={t('poweredBy')} />}
    >
      {children}
    </AppLayout>
  );
}
