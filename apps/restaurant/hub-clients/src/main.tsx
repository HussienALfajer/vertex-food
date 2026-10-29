import { textDirection } from '@vertex-food/i18n';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CSPProvider,
  DirectionProvider,
  PoweredBy,
} from '@vertex-food/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { i18n } from './i18n';
import './styles.css';

// The hub client pages (spec S04 screens 6–9, ADR 0022), served by the branch's hub PC over HTTPS
// on the LAN to phones and screens. S04's PR 5 sets up the build and serves this page; PR 7 adds
// the certificate guide, pairing, PIN sign-in and the network check; S11 and S12 the kitchen
// display and the waiter app.

document.title = i18n.t('hubClients:title');

function HubClientPage() {
  const { t } = useTranslation('hubClients');
  const { t: common } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border bg-surface px-4 py-3">
        <h1 className="font-semibold">{t('title')}</h1>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{t('placeholder.heading')}</CardTitle>
            <CardDescription>{t('placeholder.body')}</CardDescription>
          </CardHeader>
        </Card>
      </main>
      <footer className="flex justify-center px-4 py-4">
        <PoweredBy label={common('poweredBy')} />
      </footer>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <DirectionProvider direction={textDirection}>
        <CSPProvider disableStyleElements>
          <HubClientPage />
        </CSPProvider>
      </DirectionProvider>
    </I18nextProvider>
  </StrictMode>,
);
