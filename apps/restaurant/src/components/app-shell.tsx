import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** The frame of every screen. "Powered by Vertex Food" is always visible (ADR 0018). */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['common', 'restaurant']);
  return (
    <div className="shell">
      <header className="shell-header">
        <span className="shell-product">{t('productName')}</span>
        <span className="shell-label">{t('restaurant:productLabel')}</span>
      </header>
      <main className="shell-main">{children}</main>
      <footer className="shell-footer">{t('poweredBy')}</footer>
    </div>
  );
}
