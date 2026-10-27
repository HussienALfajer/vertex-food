import { AppLayout, PoweredBy, ThemeToggle } from '@vertex-food/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The frame of every screen (`AppLayout`, Vertex Hub's shell): the sidebar from 1024 px, a sheet
 * behind the menu button below; no sidebar when `navigation` is omitted (the wizard, errors).
 * "Powered by Vertex Food" is always visible (ADR 0018).
 */
export function AppShell({
  navigation,
  actions,
  children,
}: {
  navigation?: ((close: () => void) => ReactNode) | undefined;
  /** Controls before the theme button: "Switch cashier" on a registered PC. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation(['common', 'restaurant']);
  return (
    <AppLayout
      productName={t('productName')}
      productLabel={t('restaurant:productLabel')}
      navigation={navigation}
      labels={{
        skip: t('shell.skip'),
        navigation: t('restaurant:nav.label'),
        openNavigation: t('shell.openNavigation'),
      }}
      actions={
        <>
          {actions}
          <ThemeToggle labels={{ toDark: t('theme.toDark'), toLight: t('theme.toLight') }} />
        </>
      }
      footer={<PoweredBy label={t('poweredBy')} />}
    >
      {children}
    </AppLayout>
  );
}
