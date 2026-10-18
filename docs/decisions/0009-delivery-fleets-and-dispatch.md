# 0009 — Delivery: two fleets in one driver app, manual dispatch, location only on duty

Status: Accepted (location and weak network amended by [0024](0024-driver-location-confirmed-by-spike-c.md) after Spike C) · Date: 2026-10-18

## Context
Some restaurants have their own drivers; others have none; some need help at peak times. The owner wants both restaurant drivers and Vertex drivers in one driver app (owner, 2026-10-18). Drivers carry cash; delays and losses need a clear owner.

## Decision
- **Two fleets:**
  - **Restaurant fleet:** drivers created by a restaurant, tenant data; they see and receive only that restaurant's jobs.
  - **Vertex fleet:** drivers created by Vertex, platform data; they receive jobs Vertex assigns, for any restaurant whose agreement allows Vertex delivery.
  A person can be in both fleets with separate duty states per fleet.
- **Delivery job:** a delivery order gets one job: fleet, driver, states `unassigned` → `offered` → `accepted` → `at_restaurant` → `picked_up` → `delivered` | `failed` (reason) | `returned`; append-only job events with time, location and actor.
- **Assignment in V1 is manual:** the restaurant assigns its own drivers; Vertex dispatchers assign Vertex drivers in the console (F36). A restaurant can request a Vertex driver for an order. Automatic assignment is later; the job model already supports offers and declines.
- **Responsibility:** written on the job: restaurant fleet → the restaurant; Vertex fleet → Vertex. Ratings and complaints attach to the job and its responsible party.
- **Visibility:** a driver sees the customer's name, phone, address and order total only while the job is active; after delivery, the job keeps them for the restaurant and Vertex, not for the driver. Restaurant drivers never see another restaurant's jobs.
- **Location:** shared only while on duty, sampled at an interval tuned in Spike C, sent in batches on weak networks; the customer sees the driver's location only while the job is `picked_up`; locations are kept 30 days, then reduced to the job's key points.
- **Cash custody:** every cash collection is a ledger entry against the driver (ADR 0014); handovers to the restaurant or to Vertex are recorded by the receiver; a driver's running balance is always visible to the driver and to whoever they owe.
- **Weak network:** the driver app queues job events with their device time and sends them in order; the server accepts late events, keeps device and server time, and flags impossible sequences.

## Consequences
- Dispatch is a real console surface from V1.
- Spike C answers battery, background limits on cheap Android phones and network behavior before S19.
