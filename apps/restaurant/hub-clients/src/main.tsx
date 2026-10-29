import { textDirection } from '@vertex-food/i18n';
import { CSPProvider, DirectionProvider } from '@vertex-food/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { App } from './app';
import { i18n } from './i18n';
import './styles.css';

// The hub client pages (spec S04 screens 6–9, ADR 0022), served by the branch's hub PC over HTTPS
// on the LAN to phones and screens. S04's PR 5 sets up the build and serves this page; PR 7 adds
// the certificate guide, pairing, PIN sign-in and the network check; S11 and S12 the kitchen
// display and the waiter app.

document.title = i18n.t('hubClients:title');

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <DirectionProvider direction={textDirection}>
        <CSPProvider disableStyleElements>
          <App />
        </CSPProvider>
      </DirectionProvider>
    </I18nextProvider>
  </StrictMode>,
);
