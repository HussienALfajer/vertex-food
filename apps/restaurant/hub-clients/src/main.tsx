import { textDirection } from '@vertex-food/i18n';
import { CSPProvider, DirectionProvider } from '@vertex-food/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { logErrorLabel, redactConsoleErrors } from '../../src/lib/error-logging';
import { App } from './app';
import { ErrorBoundary } from './components/error-boundary';
import { i18n } from './i18n';
import './styles.css';

// The hub client pages (spec S04 screens 6–9, ADR 0022), served by the branch's hub PC over HTTPS
// on the LAN to phones and screens: the certificate guide, pairing, PIN sign-in and the network
// check. S11 and S12 add the kitchen display and the waiter app.

// Errors may carry customer data: nothing on these pages logs their message (ADR 0016).
redactConsoleErrors(console);

document.title = i18n.t('hubClients:title');

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root, {
  onCaughtError: logErrorLabel,
  onUncaughtError: logErrorLabel,
  onRecoverableError: logErrorLabel,
}).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <DirectionProvider direction={textDirection}>
        <CSPProvider disableStyleElements>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </CSPProvider>
      </DirectionProvider>
    </I18nextProvider>
  </StrictMode>,
);
