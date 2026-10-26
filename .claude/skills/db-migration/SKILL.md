---
name: db-migration
description: Change the database schema safely in packages/db — edit the Drizzle schema, add RLS policies, generate the migration, review its SQL for backward compatibility, isolation and record integrity, and test it. Use whenever a table, column, index, enum, constraint, policy, trigger or grant is added, changed or removed.
argument-hint: <what changes>
effort: high
---

Schema change: **$ARGUMENTS**. Rules: `packages/db/CLAUDE.md`, ADR 0020 (Data), ADR 0004 (tenancy); order tables also ADR 0007; money and ledger tables ADR 0014; agreement tables ADR 0013; delivery tables ADR 0009.

1. **Edit** `packages/db/src/schema/<module>.ts` with the shared column helpers. A new schema file is exported from `schema/index.ts`; every new table gets its owning module, scope (tenant or platform) and kind in the schema registry. Every foreign key gets an index; a foreign key between tenant tables is composite, `(tenant_id, x_id) → (tenant_id, id)`, with `unique (tenant_id, id)` on the parent. Command ids, idempotency keys and external references get unique indexes.
2. **Tenant tables:** `tenant_id` not null; indexes start with `tenant_id`; the custom migration enables and forces RLS and creates the `tenant_isolation` policy against `current_tenant_id()`; the app role gets only the privileges it needs (never `TRUNCATE`, `TRIGGER` or `REFERENCES`; no `DELETE` on business tables).
3. **Append-only tables** (audit, payments, refunds, order events, job events, ledger entries, agreement terms, the sync command log): no `updated_at` or `archived_at`; the migration adds `refuse_change()` triggers that refuse `UPDATE`/`DELETE`/`TRUNCATE` and grants the app role `SELECT, INSERT` only. Work queues (outbox, message status) are not append-only.
4. **Generate:** `pnpm db:generate`. Read the new `.sql` file in `packages/db/migrations/` (never `meta/`).
5. **Review the SQL.** The previous release must keep working against the migrated database, and offline restaurant devices on the previous app version must still sync. Stop and redesign as expand, then contract, if you see:
   - `DROP TABLE`, `DROP COLUMN`, or a `RENAME` of anything code or the sync rules still use;
   - `ALTER COLUMN ... TYPE` that rewrites or narrows data;
   - `SET NOT NULL`, or a new `NOT NULL` column without a default, on a table that has rows;
   - a removed or renamed enum value (order, job, payment states especially);
   - anything that changes or deletes payment, order event, ledger, agreement term or audit rows;
   - a tenant table without a forced RLS policy.
   Contract steps ship in a later release. Data backfills go in a custom migration and never touch append-only rows.
6. **Test:** `pnpm verify packages/db/test/conventions.test.ts` with the db test files for the change (migrations, the convention test with RLS checks, triggers as app role and owner), then the test files of the packages that use the tables, with `pnpm verify <files>`. Rerun only the files that failed.
7. **Confirm no drift:** running `pnpm db:generate` again reports nothing to migrate.
8. **Dev database:** `pnpm db:migrate` changes the owner's local data, so ask before running it.

Never use `drizzle-kit push`, never edit a generated migration, and commit the schema and its migration together.
