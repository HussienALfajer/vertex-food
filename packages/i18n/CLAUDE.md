# packages/i18n

The Arabic text of every front end (ADR 0018, ADR 0020): plain catalogs and locale constants, no i18n library and no I/O, so the restaurant, console and web apps and the Expo apps all read the same files. Each app wires its own i18next instance to `ar`. Copied from Vertex Shifa's `packages/i18n` and adapted.

## Layout
- `src/ar/<namespace>.ts`, collected in `src/ar/index.ts` (`ar`, `Catalog`): `common` (shared by every product), `errors` (the text of each error code of `packages/contracts`), `messaging` (the WhatsApp text of each template of `messageTemplates`, `{{param}}` placeholders naming exactly its parameters, rendered by the gateway), `sync` (spec S04: command outcomes and reasons, attention kinds, roles, connectivity and the summaries of `describe`, `commands.<module>.<action>`), `hubClients` (the pages the hub serves to phones and screens), `agreement` (spec S05: feature and limit names, sources, «اتفاقيتي», the banners and the refusals for entitlement), and one namespace per app: `restaurant`, `console`, `web`, `customer`, `driver`. A new app or area adds a namespace file.
- `src/locale.ts`: `defaultLanguage` (`ar`), `textDirection` (`rtl`), `formatLocale` (`ar-SY-u-nu-latn`, Syrian Arabic month names with Latin digits; pinned by `locale.test.ts`) for every `Intl` formatter, `displayTimeZone` (`Asia/Damascus`).
- `src/catalog.test.ts`: no empty text, no Arabic-Indic digit, a text for every error code and every message template.

## Rules
- Every text the user sees lives here; components never hold literal text.
- Digits are Latin, in text and through `formatLocale`; never format with a bare `ar` locale.
- Never put real names, restaurants, phone numbers or addresses in a text or an example: interpolate them at run time.
- A new error code in `packages/contracts` gets its text in `errors.ts`; the `satisfies Record<ErrorCode, string>` and the test fail until it does.
- Receipt and kitchen-ticket text (`packages/print`) comes from here too when that package arrives.

Run: `pnpm --filter @vertex-food/i18n test`.
