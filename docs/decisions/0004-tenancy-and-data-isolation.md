# 0004 — Tenancy: restaurants and branches, row-level security, platform-level customers and fleet

Status: Accepted · Date: 2026-10-18

## Context
Customers range from a single shop to chains with several branches. A restaurant must never see a competitor's orders, prices, customers or drivers. The customer app, the Vertex fleet and the console cross restaurants by design. Isolation that depends on every query remembering a filter is too fragile for a system written across many AI sessions.

## Decision
- **Hierarchy:** `tenant` (the contracting restaurant or chain) → `branch` (a place that cooks and sells). A single shop is a tenant with one branch: no special case in code.
- **Pool model:** one PostgreSQL database; every tenant-owned table has `tenant_id`, a row-level security policy and `FORCE ROW LEVEL SECURITY`. Apps connect as a role that cannot bypass RLS; tenant context is set per transaction from the authenticated session, never from client input. Pattern: Vertex Shifa `packages/db` (roles, `withTenant`, composite tenant foreign keys, convention test).
- **Tenant data:** menus, prices, orders, payments, cash sessions, tables, staff, restaurant drivers, restaurant customer book, settings.
- **Platform data**, outside tenant RLS and reached only through platform modules: customer accounts and addresses (ADR 0006), Vertex drivers and their locations (ADR 0009), areas, the catalog, agreements, the platform ledger.
- **Crossing points are explicit:** an order placed in the customer app is a tenant row linked to a platform customer; a delivery job by a Vertex driver links a tenant order to a platform driver. Each crossing goes through one module's public surface and is covered by isolation tests.
- **Silo option:** a tenant catalog records where each tenant's data lives, so a large chain can later move to its own database without code changes.
- **Enforcement:** a convention test fails when a table with `tenant_id` lacks a forced policy; API tests check every endpoint with a user of another tenant.

## Consequences
- Isolation holds even when application code forgets a filter.
- Marketplace and dispatch read across tenants only through audited platform roles and published read models, never by bypassing RLS in product code.
