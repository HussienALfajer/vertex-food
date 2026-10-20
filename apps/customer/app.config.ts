import { ar } from '@vertex-food/i18n';
import type { ExpoConfig } from 'expo/config';

// Store identifiers (bundle id, package name), the EAS project and icons arrive with the first store
// build (ADR 0003, Q3). The web export exists only for the E2E screenshots (owner, 2026-10-19): the
// customer's web ordering is apps/web (ADR 0015), and the export is never hosted.
const config: ExpoConfig = {
  name: ar.common.productName,
  slug: 'vertex-food',
  scheme: 'vertexfood',
  version: '0.0.0',
  // The device's orientation: every screen works on phones and tablets both ways (AGENTS.md).
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  platforms: ['android', 'ios', 'web'],
  web: { output: 'static', bundler: 'metro' },
  // Arabic right to left from the first launch, whatever the device language (ADR 0003, 0018):
  // read natively by expo-localization; src/lib/rtl.ts forces it again at start.
  extra: { supportsRTL: true, forcesRTL: true },
  plugins: [['expo-router', { sitemap: false }], 'expo-status-bar', 'expo-localization'],
};

export default config;
