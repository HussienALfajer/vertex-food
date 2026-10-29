import { ar, type Catalog, defaultLanguage } from '@vertex-food/i18n';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: Catalog;
  }
}

/**
 * The hub client pages' i18next, Arabic only, loaded synchronously from `packages/i18n`: their own
 * texts, the error codes of the LAN API and the hub's refusal reasons and roles (`sync`).
 */
export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  lng: defaultLanguage,
  fallbackLng: false,
  resources: {
    [defaultLanguage]: {
      common: ar.common,
      hubClients: ar.hubClients,
      errors: ar.errors,
      sync: ar.sync,
    },
  },
  ns: ['common', 'hubClients', 'errors', 'sync'],
  defaultNS: 'common',
  initAsync: false,
  interpolation: { escapeValue: false },
});
