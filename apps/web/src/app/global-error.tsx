'use client';

import { textDirection } from '@vertex-food/i18n';
import { DirectionProvider } from '@vertex-food/ui';
import { useEffect } from 'react';
import { AppShell } from '../components/app-shell';
import { ErrorState } from '../components/error-state';
import { logErrorLabel } from '../lib/error-logging';
import { i18n } from '../lib/i18n';
import { RootDocument } from './root-document';
import '../styles.css';

/**
 * Replaces the root layout when it fails, so this error too shows in Arabic, right to left, in
 * the device's theme.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => logErrorLabel(error), [error]);
  return (
    <RootDocument>
      <body>
        <title>{i18n.t('productName')}</title>
        <DirectionProvider direction={textDirection}>
          <AppShell>
            <ErrorState onRetry={retry} />
          </AppShell>
        </DirectionProvider>
      </body>
    </RootDocument>
  );
}
