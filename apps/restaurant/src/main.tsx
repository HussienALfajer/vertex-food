import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { textDirection } from '@vertex-food/i18n';
import { DirectionProvider, Toaster } from '@vertex-food/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { logErrorLabel, redactConsoleErrors } from './lib/error-logging';
import { i18n } from './lib/i18n';
import { createQueryClient } from './lib/query-client';
import { routeTree } from './routeTree.gen';
import './styles.css';

// Errors may carry customer data: nothing in the renderer logs their message (ADR 0016).
redactConsoleErrors(console);

// A screen's code loads when a link to it is pointed at, before it is opened.
const router = createRouter({ routeTree, defaultOnCatch: logErrorLabel, defaultPreload: 'intent' });
const queryClient = createQueryClient();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

document.title = i18n.t('productName');

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root, {
  onCaughtError: logErrorLabel,
  onUncaughtError: logErrorLabel,
  onRecoverableError: logErrorLabel,
}).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      {/* Base UI reads the direction from this provider, not from <html dir> (keyboard, placement). */}
      <DirectionProvider direction={textDirection}>
        {/* Online-only screens (S01): server state through TanStack Query, never queued offline. */}
        <QueryClientProvider client={queryClient}>
          {/* Success feedback is a toast: it never moves the screen under the cursor. */}
          <Toaster closeLabel={i18n.t('close')}>
            <RouterProvider router={router} />
          </Toaster>
        </QueryClientProvider>
      </DirectionProvider>
    </I18nextProvider>
  </StrictMode>,
);
