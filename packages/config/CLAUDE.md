# packages/config

Shared TypeScript and Biome configuration for every app and package (ADR 0002, ADR 0020). Copied from Vertex Shifa's `packages/config` and adapted.

## Layout
- `biome.json`: formatter and lint rules, extended by the root `biome.json` (which only sets the files to check: `docs/` and `spikes/` are left out).
- `tsconfig/base.json`: strict compiler options for all code. `tsconfig/node.json`: Node ESM (`NodeNext`), for packages and Node apps.
- `test/config.test.ts`: guards the settings that must never be loosened.

## Rules
- A package's `tsconfig.json` extends one of these (`@vertex-food/config/tsconfig/node.json`) and adds only paths and output options.
- Never loosen `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` or a lint rule to make a check pass: fix the code. A rule that must differ for one app goes in an `overrides` entry in `biome.json`, with the reason.
- New presets arrive with the first app that needs them, each with an export in `package.json` and a test case: `nest.json` (legacy decorators, no decorator metadata; with a Biome override for parameter decorators and static-only dynamic modules), `react.json` (Vite front ends), `expo.json` (the Expo apps), as in Vertex Shifa.
- Versions are pinned exactly (ADR 0002). TypeScript stays on 6.0: TypeScript 7 (the native compiler) ships no stable JavaScript API yet, which the NestJS, Next.js, Expo and Drizzle tooling still load. Move to 7 in its own PR once they support it.

Run: `pnpm --filter @vertex-food/config test`.
