# Vertex Food

**فيرتكس فود** — a restaurant platform for Syria, built by Vertex.

V1 ships **Vertex Food Restaurant** (an offline-first Windows POS with kitchen display, waiter app, back office and QR menu), the **Vertex Food** customer app (Android, iOS, web), the **Vertex Food Driver** app for restaurant and Vertex drivers, and the console for Vertex staff.

First market: Azaz, northern Aleppo. Arabic-first.

## Status

Phase 0 (foundation) is done: the product scope, the architecture decisions, the three spikes, the monorepo with its eight app skeletons, the design system and CI. Phase 1 is under way: S01 (tenancy and restaurant setup) and S02 (identity, access and devices) are done; S03 (WhatsApp gateway and OTP) comes next. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Documents

| Document | What it holds |
|---|---|
| [`docs/product/vision.md`](docs/product/vision.md) | The platform, its products, the business and principles |
| [`docs/product/v1-scope.md`](docs/product/v1-scope.md) | What V1 includes and excludes |
| [`docs/architecture.md`](docs/architecture.md) | Layers, repository layout, module map, key flows |
| [`docs/decisions/`](docs/decisions/README.md) | Architecture and business decisions (ADRs) |
| [`docs/specs/`](docs/specs/) | The detailed spec of each feature group, written before its code |
| [`docs/open-questions.md`](docs/open-questions.md) | Decisions still open, with the spec each one blocks |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phases and feature status |
| [`docs/workflow.md`](docs/workflow.md) | How the system is built with Claude Code |
| [`docs/testing.md`](docs/testing.md) | How the checks run, locally and in CI |
| [`docs/glossary.md`](docs/glossary.md) | Arabic and English domain terms |

## License

Copyright © 2026 Hussien Al Fajer. All rights reserved. The source is public for transparency only; see [`LICENSE`](LICENSE).
