import { ar } from '@vertex-food/i18n';
import type { ExpoConfig } from 'expo/config';

// Store identifiers (bundle id, package name), the EAS project and icons arrive with the first store
// build (ADR 0003, Q3). The customer's web ordering is apps/web, not an Expo web export (ADR 0015).
const config: ExpoConfig = {
  name: ar.common.productName,
  slug: 'vertex-food',
  scheme: 'vertexfood',
  version: '0.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  platforms: ['android', 'ios'],
  // Arabic right to left from the first launch, whatever the device language (ADR 0003, 0018):
  // read natively by expo-localization; src/lib/rtl.ts forces it again at start.
  extra: { supportsRTL: true, forcesRTL: true },
  plugins: [['expo-router', { sitemap: false }], 'expo-status-bar', 'expo-localization'],
};

export default config;
