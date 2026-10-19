import { createRouter, RouterProvider } from '@tanstack/react-router';
import { textDirection } from '@vertex-food/i18n';
import { DirectionProvider } from '@vertex-food/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { logErrorLabel, redactConsoleErrors } from './lib/error-logging';
import { i18n } from './lib/i18n';
import { routeTree } from './routeTree.gen';
import './styles.css';

// Errors may carry customer data: nothing in the renderer logs their message (ADR 0016).
redactConsoleErrors(console);

const router = createRouter({ routeTree, defaultOnCatch: logErrorLabel });

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
        <RouterProvider router={router} />
      </DirectionProvider>
    </I18nextProvider>
  </StrictMode>,
);
