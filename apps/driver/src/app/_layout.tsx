import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '@vertex-food/ui-native';
import { type ErrorBoundaryProps, Slot } from 'expo-router';
import Head from 'expo-router/head';
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

// Errors may carry customer data: nothing in the app logs or reports their message (ADR 0016).
redactConsoleErrors(console);
redactNativeErrorReports();
forceRightToLeft(I18nManager);

function Frame({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <SafeAreaProvider>
        <Head>
          <title>{i18n.t('productName')}</title>
        </Head>
        {/* Light or dark: the system's setting until the user chooses, read before the first frame. */}
        <ThemeProvider storage={AsyncStorage}>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
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
