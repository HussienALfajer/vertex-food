import { type ErrorBoundaryProps, Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { I18nManager } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppShell } from '../components/app-shell';
import { ErrorState } from '../components/error-state';
import { logErrorLabel, redactConsoleErrors } from '../lib/error-logging';
import { i18n } from '../lib/i18n';
import { redactNativeErrorReports } from '../lib/native-error-reports';
import { forceRightToLeft } from '../lib/rtl';
import { ColorsProvider } from '../lib/theme';

// Errors may carry customer data: nothing in the app logs or reports their message (ADR 0016).
redactConsoleErrors(console);
redactNativeErrorReports();
forceRightToLeft(I18nManager);

function Frame({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <ColorsProvider>
          <AppShell>{children}</AppShell>
        </ColorsProvider>
      </SafeAreaProvider>
    </I18nextProvider>
  );
}

export default function RootLayout() {
  return (
    <Frame>
      <Slot />
    </Frame>
  );
}

/** Expo Router renders this in place of the layout when a screen throws. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => logErrorLabel(error), [error]);
  return (
    <Frame>
      <ErrorState onRetry={() => void retry()} />
    </Frame>
  );
}
