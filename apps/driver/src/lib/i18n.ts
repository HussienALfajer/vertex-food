import { ar, type Catalog, defaultLanguage } from '@vertex-food/i18n';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: Catalog;
  }
}

/** The driver app's i18next, Arabic only, loaded synchronously from `packages/i18n`. */
export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  lng: defaultLanguage,
  fallbackLng: false,
  resources: { [defaultLanguage]: ar },
  ns: Object.keys(ar),
  defaultNS: 'common',
  initAsync: false,
  interpolation: { escapeValue: false },
});
