/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The API's URL (`electron/app-protocol.ts` adds its origin to `connect-src`). */
  readonly VITE_API_URL?: string;
}
