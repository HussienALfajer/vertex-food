# 0028 — Order-intake mode, and listing restaurants that keep their own cashier system

Status: Accepted (owner, 2026-10-27; supersedes ADR 0011's listing condition; details open in Q25) · Date: 2026-10-27

## Context
ADR 0011 lists in the customer app only restaurants that run the system. Many restaurants in Azaz keep a cashier program they already paid for, and would still sell through the customer app. The owner added an order-intake mode to V1 (F41) and allowed such restaurants to be listed (owner, 2026-10-27).

## Decision
- **Order-intake mode** is a mode of the restaurant app (`apps/restaurant`, in the Windows app or a browser), opened by an entitlement (ADR 0013). It offers order intake with a sound, accept with a preparation time or reject with a reason, the menu with sold-out, the branch's online-ordering settings, and the restaurant analytics of F47. It has no POS, tables, kitchen display, waiter app, printing of kitchen tickets, cash sessions or hub.
- **Online only.** Intake mode reads and writes through the API; ADR 0008's offline features do not apply to it. The branch's connectivity is the intake screen's live connection: when no intake screen of the branch is connected, its online ordering pauses, as for an offline hub (ADR 0008, 0030).
- **No integration** with the restaurant's own cashier system in V1: the restaurant enters accepted orders there itself.
- **Preparation time** is entered by hand at acceptance (no kitchen display load to suggest it, ADR 0029).
- **Listing (supersedes ADR 0011's condition):** a branch appears in the customer app when its tenant is active, its agreement includes marketplace listing, Vertex staff approved the listing, it has delivery zones or pickup enabled, and it runs either the full restaurant app or intake mode. The rest of ADR 0011 stands.
- **"Same price as in-store"** is never shown for an intake-mode branch: the platform does not know its in-store prices (ADR 0029).

## Consequences
- ADR 0011's consequence "the marketplace grows only with restaurants that run the system" no longer holds; agreements decide what intake-mode restaurants pay (ADR 0013).
- S14 builds intake mode with online order intake (F17, F41).
