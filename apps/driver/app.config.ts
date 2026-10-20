import { ar } from '@vertex-food/i18n';
import type { ExpoConfig } from 'expo/config';

// Android first, for the drivers' phones (ADR 0003). Store identifiers, the EAS project and icons
// arrive with the first store build (Q3). Location, the foreground service, the queue and their
// manifest entries arrive with S19 (ADR 0024). The web export exists only for the E2E screenshots
// (owner, 2026-10-19) and is never hosted.
const config: ExpoConfig = {
  name: ar.driver.appName,
  slug: 'vertex-food-driver',
  scheme: 'vertexfooddriver',
  version: '0.0.0',
  // The device's orientation: every screen works on phones and tablets both ways (AGENTS.md).
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  platforms: ['android', 'web'],
  web: { output: 'static', bundler: 'metro' },
  // Arabic right to left from the first launch, whatever the device language (ADR 0003, 0018):
  // read natively by expo-localization; src/lib/rtl.ts forces it again at start.
  extra: { supportsRTL: true, forcesRTL: true },
  plugins: [['expo-router', { sitemap: false }], 'expo-status-bar', 'expo-localization'],
};

export default config;
