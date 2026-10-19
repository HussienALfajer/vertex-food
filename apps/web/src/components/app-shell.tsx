import type { ReactNode } from 'react';
import { i18n } from '../lib/i18n';

/** The frame of every page. "Powered by Vertex Food" is always visible (ADR 0018). */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = i18n;
  return (
    <div className="shell">
      <header className="shell-header">
        <span className="shell-product">{t('productName')}</span>
        <span className="shell-label">{t('web:productLabel')}</span>
      </header>
      <main className="shell-main">{children}</main>
      <footer className="shell-footer">{t('poweredBy')}</footer>
    </div>
  );
}
