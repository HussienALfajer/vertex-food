import { Button } from '@vertex-food/ui';
import { RotateCwIcon } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageShell, Screen } from './page-shell';

function ErrorScreen() {
  const { t } = useTranslation('hubClients');
  return (
    <PageShell connection={null} session={null} onSignOut={() => undefined}>
      <Screen heading={t('error.heading')} description={t('error.description')}>
        <Button onClick={() => window.location.reload()}>
          <RotateCwIcon aria-hidden />
          {t('error.reload')}
        </Button>
      </Screen>
    </PageShell>
  );
}

/**
 * A page that fails to render shows the error state with a reload, never a blank phone or kitchen
 * screen (ADR 0020). React logs the error by its name only (`main.tsx`); the outbox in IndexedDB
 * survives the reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? <ErrorScreen /> : this.props.children;
  }
}
