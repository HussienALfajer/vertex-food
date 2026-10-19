import { defaultLanguage, textDirection } from '@vertex-food/i18n';
import { DirectionProvider } from '@vertex-food/ui';
import { themeInitPath } from '@vertex-food/ui/theme';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import favicon from '../../../../brand/logo/svg/favicon.svg';
import { AppShell } from '../components/app-shell';
import { i18n } from '../lib/i18n';
import '../styles.css';

export const metadata: Metadata = { title: i18n.t('productName'), icons: favicon.src };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // `theme-init.js` puts the `dark` class on <html> before hydration: React leaves it alone.
    <html lang={defaultLanguage} dir={textDirection} suppressHydrationWarning>
      <head>
        {/* Synchronous, before the body is painted: the device's theme without a flash. */}
        <script src={themeInitPath} />
      </head>
      <body>
        <DirectionProvider direction={textDirection}>
          <AppShell>{children}</AppShell>
        </DirectionProvider>
      </body>
    </html>
  );
}
