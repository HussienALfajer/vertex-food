import { defaultLanguage, textDirection } from '@vertex-food/i18n';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '../components/app-shell';
import { i18n } from '../lib/i18n';
import '../styles.css';

export const metadata: Metadata = { title: i18n.t('productName') };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={defaultLanguage} dir={textDirection}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
