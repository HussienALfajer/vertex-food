-- Spike A schema: the minimum to exercise ADR 0007 and ADR 0008 for a branch hub. Synthetic data only.
CREATE DATABASE powersync_storage;

-- The API connects as food_app (subject to RLS). PowerSync replicates as powersync_role (Vertex Shifa ADR 0021).
CREATE ROLE food_app LOGIN PASSWORD 'spike-only-password' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE powersync_role LOGIN PASSWORD 'spike-only-password' REPLICATION BYPASSRLS;

CREATE TABLE devices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  name text NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE menu_items (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  name text NOT NULL,
  station text NOT NULL
);

-- Append-only: a price change is a new row (ADR 0014).
CREATE TABLE prices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES menu_items(id),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL,
  effective_from timestamptz NOT NULL
);

CREATE TABLE dining_tables (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  label text NOT NULL
);

-- Order numbers come from per-device daily ranges, allocated online (ADR 0008).
CREATE TABLE number_ranges (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  device_id uuid NOT NULL,
  business_day date NOT NULL,
  first_number int NOT NULL,
  last_number int NOT NULL,
  UNIQUE (branch_id, business_day, device_id),
  UNIQUE (branch_id, business_day, first_number)
);

CREATE TABLE orders (
  id uuid PRIMARY KEY, -- UUIDv7 from the device that took the order
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  business_day date NOT NULL,
  number int,
  channel text NOT NULL CHECK (channel IN ('pos', 'waiter', 'marketplace')),
  table_id uuid REFERENCES dining_tables(id),
  status text NOT NULL CHECK (status IN ('open', 'paid')),
  currency text NOT NULL,
  subtotal_minor bigint NOT NULL DEFAULT 0, -- recomputed by the server from line snapshots
  paid_minor bigint NOT NULL DEFAULT 0,
  opened_by_device_id uuid,
  created_at timestamptz NOT NULL
);
-- The database refuses a duplicate daily number.
CREATE UNIQUE INDEX orders_number_per_day ON orders (branch_id, business_day, number) WHERE number IS NOT NULL;

CREATE TABLE order_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id),
  item_id uuid NOT NULL REFERENCES menu_items(id),
  price_id uuid NOT NULL REFERENCES prices(id),
  name text NOT NULL, -- snapshot
  station text NOT NULL, -- snapshot
  unit_minor bigint NOT NULL, -- snapshot of the price the device used
  quantity int NOT NULL CHECK (quantity > 0),
  line_minor bigint NOT NULL,
  currency text NOT NULL,
  ticket_id uuid,
  added_by_device_id uuid
);

CREATE TABLE kitchen_tickets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id),
  order_number int,
  station text NOT NULL,
  status text NOT NULL CHECK (status IN ('new', 'preparing', 'ready', 'served')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

-- Append-only tables.
CREATE TABLE payments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL,
  method text NOT NULL,
  command_id uuid NOT NULL,
  taken_at timestamptz NOT NULL -- device time
);

CREATE TABLE order_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id),
  seq int NOT NULL, -- server order of the order's events
  type text NOT NULL,
  command_id uuid NOT NULL,
  origin_device_id uuid,
  device_time timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  UNIQUE (order_id, seq)
);

-- Every command any PC uploads, with the server's decision. Idempotency key = command id.
CREATE TABLE command_log (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  uploaded_by_device_id uuid NOT NULL, -- the PC whose token uploaded it first
  executed_by_device_id uuid NOT NULL, -- the PC that was the hub when the command was taken
  origin_device_id uuid NOT NULL, -- where the user acted (a hub PC, a waiter phone, a kitchen display)
  user_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  hub_epoch int NOT NULL,
  hub_seq int NOT NULL,
  device_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'adjusted', 'rejected')),
  outcome_detail jsonb NOT NULL DEFAULT '{}'
);

CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
CREATE TRIGGER command_log_append_only BEFORE UPDATE OR DELETE ON command_log FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER order_events_append_only BEFORE UPDATE OR DELETE ON order_events FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER prices_append_only BEFORE UPDATE OR DELETE ON prices FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Tenant isolation (ADR 0004): tenant context per transaction.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['devices','menu_items','prices','dining_tables','number_ranges','orders','order_lines','kitchen_tickets','payments','order_events','command_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON devices, menu_items, dining_tables, number_ranges, orders, order_lines, kitchen_tickets TO food_app;
GRANT SELECT, INSERT ON prices, payments, order_events, command_log TO food_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO food_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;

CREATE PUBLICATION powersync FOR TABLE menu_items, prices, dining_tables, number_ranges, orders, order_lines, kitchen_tickets, payments, command_log;
