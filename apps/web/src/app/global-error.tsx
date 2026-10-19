'use client';

import { defaultLanguage, textDirection } from '@vertex-food/i18n';
import { useEffect } from 'react';
import { AppShell } from '../components/app-shell';
import { ErrorState } from '../components/error-state';
import { logErrorLabel } from '../lib/error-logging';
import { i18n } from '../lib/i18n';
import '../styles.css';

/** Replaces the root layout when it fails, so this error too shows in Arabic, right to left. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => logErrorLabel(error), [error]);
  return (
    <html lang={defaultLanguage} dir={textDirection}>
      <body>
        <title>{i18n.t('productName')}</title>
        <AppShell>
          <ErrorState onRetry={retry} />
        </AppShell>
      </body>
    </html>
  );
}
