# Tasks

The live checklist of the current spec or Phase 0 item, replaced when the next one starts. Tick items as they finish; add work you discover.

## Phase 0 — Monorepo scaffold (`chore/monorepo-scaffold`)

- [x] Root: pnpm workspace (`apps/*`, `packages/*`; spikes stay out), Turborepo with `agentGuidance: false`, `.node-version`, exact versions
- [x] Biome at the root extending `packages/config`; the existing `.claude/hooks/biome-format.mjs` runs it on every edit
- [x] `packages/config`: strict `base` and `node` tsconfig presets, Biome rules, tests guarding them
- [x] CI: lint, typecheck, build, audit, migration drift (no-op until `packages/db`), tests, gate job, gitleaks
- [x] Folder `CLAUDE.md` files: `packages/config`, `.github`
- [x] `AGENTS.md` commands table, roadmap, README
- [ ] Checker passes and CI is green on the PR
