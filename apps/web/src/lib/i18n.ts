import { ar, type Catalog, defaultLanguage } from '@vertex-food/i18n';
import i18next from 'i18next';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: Catalog;
  }
}

/**
 * The web app's i18next, Arabic only, loaded synchronously from `packages/i18n`. Used directly, not
 * through `react-i18next`: server components have no React context.
 */
export const i18n = i18next.createInstance();

void i18n.init({
  lng: defaultLanguage,
  fallbackLng: false,
  resources: { [defaultLanguage]: ar },
  ns: Object.keys(ar),
  defaultNS: 'common',
  initAsync: false,
  interpolation: { escapeValue: false },
});
