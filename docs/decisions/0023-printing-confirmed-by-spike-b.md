# 0023 — Printing confirmed by Spike B: images rendered in the main process, raw ESC/POS, a durable print queue

Status: Accepted (owner, 2026-10-18) · Date: 2026-10-18 · Amends the printing part of [0008](0008-offline-first-restaurant-and-lan-hub.md); builds on [0022](0022-branch-hub-confirmed-by-spike-a.md) (the hub prints kitchen tickets)

## Context
ADR 0008 makes printing local. `packages/print` renders receipts and kitchen tickets, and the restaurant app sends them to USB or network ESC/POS printers without internet. It left Spike B to choose between two ways of printing Arabic: rendering to an image, or using the printer's code page.

The spike printed a synthetic receipt and kitchen ticket at 58 mm and 80 mm through a printer emulator. Everything ran in Node 24.21 and in Electron 44.4.3's main process. All 40 checks passed in Node, and 44 in Electron, which adds a Chromium comparison, in six consecutive runs after the last change. It covered:
- the image path and the IBM 864 code-page path;
- network and USB transports;
- the cash drawer;
- printer faults;
- a print queue killed in the middle of a send.

No real printer was available, and no branch hub was involved: the spike printed from one process. Report: [`docs/spikes/B-printing.md`](../spikes/B-printing.md). Labels:
- *(not tested)*: a design decision the spike did not exercise;
- *(hardware)*: waits for real printers (Q8);
- *(modelled)*: shown only against the emulator's own model of a printer.

## Decision

### Confirmed from ADR 0008
- Printing is local and needs no internet.
- `packages/print` renders receipts and kitchen tickets.
- The restaurant app sends them to USB or network ESC/POS printers from Electron's main process.

### Render to an image, not the code page (replaces "rendered to an image or the printer's code page")
- A receipt or ticket is a **document of blocks**: logo, text with size, weight and alignment, a row with its label on the right and its amount on the left, an inverted banner, a rule, a feed. The document carries no printer commands.
- `packages/print` renders the document to a **1-bit page** with Skia (`@napi-rs/canvas`): HarfBuzz shapes Arabic, and the bidi algorithm orders mixed Arabic, Latin and digits. It runs in Electron's main process without a window, and in plain Node for tests. A worker thread is possible but was not tried *(not tested)*.
- **The font is bundled:** Noto Sans Arabic, under the SIL Open Font License, with its Latin and Latin Extended subsets. Skia falls back to Windows fonts silently for any character the bundled fonts lack. So `packages/print` checks every printed character against the fonts' character maps and treats a gap as a bug; the spike's documents had none.
- The bundled fonts have no "₺". TRY amounts print the currency as text, for example "TL", unless a font with the sign is added. S07 decides the currency labels on paper.
- The page is sent as `GS v 0` raster in bands, at most 256 rows by default and configurable per printer *(hardware)*.
- The code page is rejected. On IBM 864, 18 to 28 % of the characters printed in the wrong letter form. It has no "إ" and no Turkish letters. Its table number differs by maker, and it needs its own shaper, bidi and fixed-width layout. Chromium rendering is not used either: it gives the same quality but is 6 to 20 times slower and needs an offscreen window.
- Layout rules:
  - widths of 384 dots (58 mm) and 576 dots (80 mm), set per printer;
  - Latin digits;
  - body text at least 22 dots (58 mm) or 25 dots (80 mm), and kitchen items 30 dots or more, bold;
  - "Powered by Vertex Food" on every receipt (ADR 0018).
  Sizes are to confirm on real paper *(hardware)*.
- **Logo:** the tenant's logo (ADR 0010) is converted once per paper width when it is uploaded, by threshold or dithering, with a preview. It is cached and capped in width. A black-and-white upload is recommended.

### Transports
- **Network printers:** raw TCP, by default on port 9100. Each job:
  1. asks the real-time status (`DLE EOT 1, 2, 4`) and sends nothing when the printer is offline, has its cover open or is out of paper;
  2. sends the job;
  3. sends `GS r` and treats its answer as "printed".

  Connecting, the status answer and printing each have a timeout, so no wait can last forever. Errors are typed. Before the first job byte is written, nothing printed: `unreachable`, `no_answer`, `not_ready`, `dropped`. After it, the job may have printed: `cut_off`, `not_confirmed`. *(Hardware: whether each model answers `GS r` only after printing.)*
- **USB printers:** each is installed as a Windows print queue, with its maker's driver or the built-in "Generic / Text Only" driver on its USB port. The app sends RAW jobs through `winspool.drv`, called with `koffi` (no native build). The spooler gives no status and no printed answer, so a USB job counts as printed once the spooler accepts it. Installing the queue is an onboarding step that needs administrator rights. *(Hardware: no job reached a real USB printer in the spike.)*
- **Kitchen printers are network printers.** After a failover (ADR 0022), the new hub must reach every station printer, and a USB printer stays with its PC. A receipt printer and its cash drawer may be USB on the cashier's PC. *(Not tested.)*

### Who prints *(not tested: the spike had no hub)*
- **Only the active hub sends kitchen tickets** (ADR 0022). It enqueues a ticket's print job in the same local transaction as the journal entry that resolves the ticket, so a ticket never exists without its job.
- **A standby** applies the same journal entries and keeps the same jobs, pending and never sent. It sends them only after it is promoted, and then only the jobs that the old hub's "printed" marks do not cover, as marked reprints. The hub mirrors each "printed" mark to the standby, like a journal entry.
- **After a split:** a PC that served alone printed its own tickets. When it forwards its entries on heal, each entry carries its printed mark. The hub enqueues only the entries that were never printed, as marked reprints. So nothing is printed twice unmarked, and nothing that the isolated PC failed to print is lost.
- **Receipts** print on the receipt printer of the PC where the cashier takes the payment, often a USB printer with the drawer. A cashier PC that is not the hub sends the payment to the hub. It enqueues the receipt, keyed by the payment id, when the hub's answer arrives, so the job is not part of the journal transaction. A receipt requested from a waiter phone is enqueued by the hub for the receipt printer configured for that area.
- If cheap network printers serve one connection at a time *(modelled; hardware)*, a second sender waits, so its status timeout must cover one job. Kitchen tickets come from one PC, the hub, so this only affects a printer shared with receipts.

### A durable print queue, at-least-once
- One FIFO queue per printer. Each job is keyed by the id of the ticket or receipt, so enqueuing the same job again does nothing.
- The queue is a local-only table in the restaurant app's database, never uploaded *(not tested; the spike used an append-only log with `fsync`)*.
- A send is recorded only once the printer has answered that it is ready, just before the first job byte goes out.
- **A job that never reached the printer** is retried as it was, as new, with its drawer kick: unreachable, no answer, not ready, a connection dropped before the job started, or the app stopping before the send was recorded.
- **A job that may have printed** is printed again with "نسخة معادة" at the top: the connection was cut after the job started, the "printed" answer never came, or the app stopped after the send was recorded. The kitchen may see a marked duplicate, never a missing ticket.
- A reprint never kicks the cash drawer.
- Nothing is dropped. Every failed attempt raises an alert naming the printer and the reason; retries back off. The spike raised the alert as an event. Showing it on the cashier screen and the kitchen display, for example "طابعة المشاوي: نفد الورق", is for S11 *(not tested)*.

### Amounts on paper
- The receipt builder computes no money. Every amount, rate, conversion and the change comes from the resolved order and payment (`packages/contracts` money and totals, ADR 0007, 0014), as the hub resolved them. So the paper always matches the ledger's figures. The spike computed its fixture totals itself, for the pictures only.

### Cash drawer
- The drawer opens with `ESC p` (pin 2, 50 ms on, 500 ms off), sent at the start of a cash receipt so the drawer opens while the receipt prints. Pin and timing are set per printer *(hardware)*.
- Opening the drawer without a sale is a separate command with its own permission and an audit entry (ADR 0005, 0016) *(not tested)*.

## Consequences
- `packages/print` holds:
  - the document model and the receipt and ticket builders;
  - the Skia renderer with the bundled font;
  - logo conversion;
  - the ESC/POS encoder;
  - the network and spooler transports;
  - the print queue.

  It is tested with the spike's printer emulator and golden 1-bit pages. Its tests cover:
  - status refusals;
  - a silent printer;
  - connections dropped before and cut after the job started;
  - a killed queue;
  - reprints without a drawer kick;
  - font coverage.
- New dependencies:
  - `@napi-rs/canvas`, an N-API prebuilt that loads in Electron without a rebuild;
  - `koffi`;
  - the Noto Sans Arabic font files, about 135 KB, with the OFL notice shipped.

  `iconv-lite` is not needed.
- Speed is set by the printer, not the software. Rendering takes 2 to 8 ms and jobs are 19 to 70 KB (measured). At 90 to 150 mm/s, printing takes 0.45 to 1.4 s *(modelled from the paper length)*. Bluetooth and serial printers are out of V1.
- Printing runs in the main process with the hub. That process installs its own handlers for uncaught exceptions and unhandled rejections, because Electron's default handler shows a modal dialog and the process stalls until it is closed. The spike's test runner stalled this way.
- Onboarding:
  - gives network printers fixed addresses (a DHCP reservation);
  - installs USB printers as Windows queues;
  - sets each printer's width, band size and drawer pin;
  - prints a test page from the branch settings.
- S11 (kitchen routing and printing) and S10 (payments, receipts, drawer) build on this ADR. S11 answers Q18: a backup printer when a station's printer fails.
- Still open after the spike, all on real printers (Q8):
  - `GS v 0` limits;
  - the `DLE EOT` and `GS r` behaviour;
  - more than one connection at a time (the emulator's one-at-a-time behaviour is an assumption);
  - RAW spooler jobs on USB;
  - drawer pins;
  - print density and cutters;
  - printer power loss in the middle of a ticket;
  - Wi-Fi printers;
  - legibility checked with kitchen staff.
