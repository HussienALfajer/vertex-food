# 0023 — Printing confirmed by Spike B: images rendered in the main process, raw ESC/POS, a durable print queue

Status: Proposed · Date: 2026-10-18 · Amends the printing part of [0008](0008-offline-first-restaurant-and-lan-hub.md); builds on [0022](0022-branch-hub-confirmed-by-spike-a.md) (the hub prints kitchen tickets)

## Context
ADR 0008 makes printing local. `packages/print` renders receipts and kitchen tickets, and the restaurant app sends them to USB or network ESC/POS printers without internet. It left Spike B to choose between two ways of printing Arabic: rendering to an image, or using the printer's code page.

The spike printed a synthetic receipt and kitchen ticket at 58 mm and 80 mm through a printer emulator. Everything ran in Node 24.21 and in Electron 44.4.3's main process. All 37 checks passed in Node, and 41 in Electron, which adds a Chromium comparison, in seven consecutive runs. It covered:
- the image path and the IBM 864 code-page path;
- network and USB transports;
- the cash drawer;
- printer faults;
- a print queue killed in the middle of a send.

No real printer was available. Report: [`docs/spikes/B-printing.md`](../spikes/B-printing.md). Items marked *(not tested)* are design decisions the spike did not exercise. Items marked *(hardware)* wait for real printers (Q8).

## Decision

### Confirmed from ADR 0008
- Printing is local and needs no internet.
- `packages/print` renders receipts and kitchen tickets.
- The restaurant app sends them to USB or network ESC/POS printers from Electron's main process.

### Render to an image, not the code page (replaces "rendered to an image or the printer's code page")
- A receipt or ticket is a **document of blocks**: logo, text with size, weight and alignment, a row with its label on the right and its amount on the left, an inverted banner, a rule, a feed. The document carries no printer commands.
- `packages/print` renders the document to a **1-bit page** with Skia (`@napi-rs/canvas`): HarfBuzz shapes Arabic, and the bidi algorithm orders mixed Arabic, Latin and digits. It runs in Electron's main process, or a worker thread, without a window, and in plain Node for tests.
- **The font is bundled:** Noto Sans Arabic, under the SIL Open Font License, with its Latin and Latin Extended subsets. Receipts never use the fonts of the Windows install.
- The page is sent as `GS v 0` raster in bands, at most 256 rows by default and configurable per printer *(hardware)*.
- The code page is rejected. On IBM 864, 18 to 28 % of the characters printed in the wrong letter form. It has no "إ" and no Turkish letters. Its table number differs by maker, and it needs its own shaper, bidi and fixed-width layout. Chromium rendering is not used either: it gives the same quality but is 6 to 17 times slower and needs an offscreen window.
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

  Connecting, the status answer and printing each have a timeout, so no wait can last forever. Errors are typed: `unreachable`, `no_answer`, `not_ready`, `cut_off`, `not_confirmed`. *(Hardware: whether each model answers `GS r` only after printing.)*
- **USB printers:** each is installed as a Windows print queue, with its maker's driver or the built-in "Generic / Text Only" driver on its USB port. The app sends RAW jobs through `winspool.drv`, called with `koffi` (no native build). The spooler gives no status and no printed answer, so a USB job counts as printed once the spooler accepts it. Installing the queue is an onboarding step that needs administrator rights. *(Hardware: no job reached a real USB printer in the spike.)*
- **Kitchen printers are network printers.** After a failover (ADR 0022), the new hub must reach every station printer, and a USB printer stays with its PC. A receipt printer and its cash drawer may be USB on the cashier's PC. *(Not tested.)*

### Who prints
- Kitchen tickets are printed by the **active hub**, which resolves them (ADR 0022).
- Receipts are printed by the PC where the cashier takes the payment. A receipt requested from a waiter phone goes through the hub to the receipt printer configured for that area.
- A network printer serves one connection at a time, so a second sender waits. Its status timeout covers one job.

### A durable print queue, at-least-once
- One FIFO queue per printer. Each job is keyed by the id of the ticket or receipt, so enqueuing the same job again does nothing.
- The queue is a local-only table in the restaurant app's database. A job is written in the same transaction as the journal entry that creates the ticket or the payment, so a ticket never exists without its print job *(not tested; the spike used an append-only log with `fsync`)*.
- Each send is recorded before the bytes go out.
- **A job that never reached the printer** (unreachable, not ready) is retried as it was.
- **A job that may have printed** is printed again with "نسخة معادة" at the top: the connection was cut, the "printed" answer never came, or the app stopped while sending. The kitchen may see a marked duplicate, never a missing ticket.
- A reprint never kicks the cash drawer.
- Nothing is dropped. Every failed attempt raises an alert on the cashier screen naming the printer and the reason, for example "طابعة المشاوي: نفد الورق". Retries back off.
- After a failover, the new hub reprints, with the mark, the tickets that the old hub's "printed" marks do not cover. Those marks are mirrored to the standby like journal entries *(not tested)*.

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

  It is tested with the spike's printer emulator and golden 1-bit pages. Its tests cover status refusals, a silent printer, a cut connection, a killed queue, and reprints without a drawer kick.
- New dependencies:
  - `@napi-rs/canvas`, an N-API prebuilt that loads in Electron without a rebuild;
  - `koffi`;
  - the Noto Sans Arabic font files, about 135 KB, with the OFL notice shipped.

  `iconv-lite` is not needed.
- Speed is set by the printer, not the software. Rendering takes 2 to 7 ms. Jobs are 19 to 70 KB. Printing takes 0.45 to 1.4 s at 90 to 150 mm/s. Bluetooth and serial printers are out of V1.
- Onboarding:
  - gives network printers fixed addresses (a DHCP reservation);
  - installs USB printers as Windows queues;
  - sets each printer's width, band size and drawer pin;
  - prints a test page from the branch settings.
- S11 (kitchen routing and printing) and S10 (payments, receipts, drawer) build on this ADR. S11 answers Q18: a backup printer when a station's printer fails.
- Still open after the spike, all on real printers (Q8):
  - `GS v 0` limits;
  - the `DLE EOT` and `GS r` behaviour;
  - more than one connection at a time;
  - RAW spooler jobs on USB;
  - drawer pins;
  - print density and cutters;
  - printer power loss in the middle of a ticket;
  - Wi-Fi printers;
  - legibility checked with kitchen staff.
