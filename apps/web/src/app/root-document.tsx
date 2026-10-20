import { defaultLanguage, textDirection } from '@vertex-food/i18n';
import { themeInitPath } from '@vertex-food/ui/theme';
import type { ReactNode } from 'react';

/**
 * The <html> of the root layout and of `global-error.tsx`, which replaces it: both apply the
 * device's theme before the body is painted.
 */
export function RootDocument({ children }: { children: ReactNode }) {
  return (
    // `theme-init.js` puts the `dark` class on <html> before hydration: React leaves it alone.
    <html lang={defaultLanguage} dir={textDirection} suppressHydrationWarning>
      <head>
        {/* Synchronous, before the body is painted: the device's theme without a flash. */}
        <script src={themeInitPath} />
      </head>
      {children}
    </html>
  );
}
