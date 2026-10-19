# packages/config

Shared TypeScript and Biome configuration for every app and package (ADR 0002, ADR 0020). Copied from Vertex Shifa's `packages/config` and adapted.

## Layout
- `biome.json`: formatter and lint rules, extended by the root `biome.json` (which only sets the files to check: `docs/` and `spikes/` are left out).
- `biome.json` has one override, for the NestJS apps (`apps/api`, `apps/worker`, `apps/whatsapp-gateway`): constructor injection needs parameter decorators (`@Inject`), and a dynamic module is a class with only a static `forRoot`.
- `tsconfig/base.json`: strict compiler options for all code. `tsconfig/node.json`: Node ESM (`NodeNext`), for packages and Node apps. `tsconfig/nest.json`: `node.json` plus the legacy decorators, for the NestJS apps; no decorator metadata, so injection is always explicit (`@Inject(token)`). `tsconfig/react.json`: bundler resolution, the DOM and JSX, for the Vite and Next.js front ends (no emit). `tsconfig/expo.json`: bundler resolution with the `react-native` condition and JSX, for the Expo apps (no emit: Metro builds them).
- `test/config.test.ts`: guards the settings that must never be loosened.

## Rules
- A package's `tsconfig.json` extends one of these (`@vertex-food/config/tsconfig/node.json`) and adds only paths and output options.
- Never loosen `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` or a lint rule to make a check pass: fix the code. A rule that must differ for one app goes in an `overrides` entry in `biome.json`, with the reason.
- A new preset arrives with the first app that needs it, with an export in `package.json` and a test case.
- Versions are pinned exactly (ADR 0002). TypeScript stays on 6.0: TypeScript 7 (the native compiler) ships no stable JavaScript API yet, which the NestJS, Next.js, Expo and Drizzle tooling still load. Move to 7 in its own PR once they support it.

Run: `pnpm --filter @vertex-food/config test`.
