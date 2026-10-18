# Tasks

The live checklist of the current spec or Phase 0 item, replaced when the next one starts. Tick items as they finish; add work you discover.

## Phase 0 — Spike B, printing (`spike/printing`)

- [x] Spike code in `spikes/printing/`: document model, Skia image path, IBM 864 code-page path, ESC/POS encoder, network and spooler transports, durable print queue, printer emulator
- [x] Scenarios: shaping and direction, 58 and 80 mm rendering, dot-exact round trip, banded raster, "printed" answer, drawer kick, paper out, cover open, printer off, silent link, two PCs on one printer, queue with the printer off, paper out, a cut connection, the app killed while sending, spooler binding
- [x] Runs in Node and in Electron's main process, with the Chromium comparison (37 of 37 checks in Node, 41 of 41 in Electron, seven consecutive runs)
- [x] Findings report `docs/spikes/B-printing.md` with previews
- [x] ADR 0023 (proposed) amending ADR 0008's printing; roadmap, architecture, glossary, decision index and open questions (Q8, Q18) updated
- [ ] Reviewer run and blocking findings fixed
- [ ] Owner approves ADR 0023 before the PR merges
