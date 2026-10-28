-- Sync foundation (spec S04, ADR 0022, 0035): isolation of the sync tables, append-only guards,
-- the app and jobs roles' access, the first access snapshot of every membership, and the
-- `powersync` publication with the sync role's reads.

-- Tenant tables: forced RLS and the one tenant_isolation policy (ADR 0004).
ALTER TABLE membership_access_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE membership_access_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON membership_access_snapshots
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE command_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE command_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON command_log
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE command_payloads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE command_payloads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON command_payloads
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE command_replays ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE command_replays FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON command_replays
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE number_blocks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE number_blocks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON number_blocks
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE device_sync_states ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE device_sync_states FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON device_sync_states
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE branch_connectivity ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE branch_connectivity FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON branch_connectivity
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE branch_connectivity_changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE branch_connectivity_changes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON branch_connectivity_changes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE branch_certificate_authorities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE branch_certificate_authorities FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON branch_certificate_authorities
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE branch_ca_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE branch_ca_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON branch_ca_keys
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE device_certificates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE device_certificates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON device_certificates
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE quarantine_batches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quarantine_batches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON quarantine_batches
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE quarantine_commands ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quarantine_commands FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON quarantine_commands
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE quarantine_decisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quarantine_decisions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON quarantine_decisions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE attention_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attention_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON attention_items
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE attention_resolutions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attention_resolutions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON attention_resolutions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

-- Append-only for every role (ADR 0016): the command log and what hangs off it, number blocks,
-- certificates and CA keys, quarantine batches and decisions, attention items and resolutions,
-- access snapshots.
CREATE TRIGGER membership_access_snapshots_refuse_change BEFORE UPDATE OR DELETE ON membership_access_snapshots
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER membership_access_snapshots_refuse_truncate BEFORE TRUNCATE ON membership_access_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER command_log_refuse_change BEFORE UPDATE OR DELETE ON command_log
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER command_log_refuse_truncate BEFORE TRUNCATE ON command_log
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER command_payloads_refuse_change BEFORE UPDATE OR DELETE ON command_payloads
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER command_payloads_refuse_truncate BEFORE TRUNCATE ON command_payloads
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER command_replays_refuse_change BEFORE UPDATE OR DELETE ON command_replays
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER command_replays_refuse_truncate BEFORE TRUNCATE ON command_replays
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER number_blocks_refuse_change BEFORE UPDATE OR DELETE ON number_blocks
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER number_blocks_refuse_truncate BEFORE TRUNCATE ON number_blocks
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER branch_connectivity_changes_refuse_change BEFORE UPDATE OR DELETE ON branch_connectivity_changes
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER branch_connectivity_changes_refuse_truncate BEFORE TRUNCATE ON branch_connectivity_changes
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER branch_ca_keys_refuse_change BEFORE UPDATE OR DELETE ON branch_ca_keys
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER branch_ca_keys_refuse_truncate BEFORE TRUNCATE ON branch_ca_keys
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER device_certificates_refuse_change BEFORE UPDATE OR DELETE ON device_certificates
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER device_certificates_refuse_truncate BEFORE TRUNCATE ON device_certificates
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER quarantine_batches_refuse_change BEFORE UPDATE OR DELETE ON quarantine_batches
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER quarantine_batches_refuse_truncate BEFORE TRUNCATE ON quarantine_batches
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER quarantine_commands_refuse_change BEFORE UPDATE OR DELETE ON quarantine_commands
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER quarantine_commands_refuse_truncate BEFORE TRUNCATE ON quarantine_commands
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER quarantine_decisions_refuse_change BEFORE UPDATE OR DELETE ON quarantine_decisions
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER quarantine_decisions_refuse_truncate BEFORE TRUNCATE ON quarantine_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER attention_items_refuse_change BEFORE UPDATE OR DELETE ON attention_items
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER attention_items_refuse_truncate BEFORE TRUNCATE ON attention_items
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER attention_resolutions_refuse_change BEFORE UPDATE OR DELETE ON attention_resolutions
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER attention_resolutions_refuse_truncate BEFORE TRUNCATE ON attention_resolutions
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- The app role: SELECT and INSERT everywhere, UPDATE only of the columns that change. No DELETE.
REVOKE ALL ON membership_access_snapshots, command_log, command_payloads, command_replays,
  number_blocks, device_sync_states, branch_connectivity, branch_connectivity_changes,
  branch_certificate_authorities, branch_ca_keys, device_certificates, quarantine_batches,
  quarantine_commands, quarantine_decisions, attention_items, attention_resolutions FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON membership_access_snapshots, command_log, command_payloads,
  command_replays, number_blocks, device_sync_states, branch_connectivity,
  branch_connectivity_changes, branch_certificate_authorities, branch_ca_keys, device_certificates,
  quarantine_batches, quarantine_commands, quarantine_decisions, attention_items,
  attention_resolutions TO food_app;
--> statement-breakpoint
-- A PC's heartbeat state is upserted in place.
GRANT UPDATE (last_heartbeat_at, recent_rtt_ms, pending_uploads, live_role, hub_epoch,
  standby_in_sync, app_version, protocol, lan_addresses, clock_offset_ms, updated_at)
  ON device_sync_states TO food_app;
--> statement-breakpoint
GRANT UPDATE (state, since, healthy_streak, updated_at) ON branch_connectivity TO food_app;
--> statement-breakpoint
-- A branch CA is retired by archiving it; its certificate and key never change.
GRANT UPDATE (archived_at, updated_at) ON branch_certificate_authorities TO food_app;
--> statement-breakpoint
-- The configured hub and standby are chosen online (rule 38).
GRANT UPDATE (hub_role) ON devices TO food_app;
--> statement-breakpoint

-- The platform-jobs role (ADR 0004). sync/connectivity-sweep reads every branch's connectivity
-- through its own policy, then, inside each tenant, its PCs' heartbeats; it moves the state and
-- writes the change and its event (outbox_events, already granted). The device.revoked.v1 consumer
-- clears the revoked PC's hub role inside its tenant.
CREATE POLICY jobs_sweep ON branch_connectivity FOR SELECT TO food_jobs
  USING (true);
--> statement-breakpoint
GRANT SELECT, UPDATE (state, since, healthy_streak, updated_at) ON branch_connectivity TO food_jobs;
--> statement-breakpoint
GRANT SELECT ON device_sync_states TO food_jobs;
--> statement-breakpoint
GRANT INSERT ON branch_connectivity_changes TO food_jobs;
--> statement-breakpoint
GRANT SELECT, UPDATE (hub_role, updated_at) ON devices TO food_jobs;
--> statement-breakpoint

-- The first access snapshot of every membership, as it stands now, from its creation; S02's write
-- paths append the next ones. Permissions are computed with this release's presets and limits
-- (`effectivePermissions` in @vertex-food/contracts), written out here as they are today. The
-- owner role sees tenant rows only inside a tenant's context, so each tenant is entered in turn.
DO $$
DECLARE
  tenant record;
BEGIN
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant.id::text, true);
    WITH catalog(permission, position) AS (
      VALUES ('tenant.view', 1), ('tenant.profile.edit', 2), ('branch.settings.edit', 3),
        ('branch.hours.edit', 4), ('branch.security.edit', 5), ('staff.view', 6),
        ('staff.manage', 7), ('staff.permissions.adjust', 8), ('devices.manage', 9),
        ('backoffice.remote', 10), ('hub.manage', 11), ('sync.attention.resolve', 12),
        ('sync.quarantine.review', 13)
    ), presets(role, permission) AS (
      SELECT 'owner', permission FROM catalog
      UNION ALL
      SELECT 'manager', unnest(array['tenant.view', 'branch.hours.edit', 'branch.security.edit',
        'staff.view', 'staff.manage', 'devices.manage', 'backoffice.remote', 'hub.manage',
        'sync.attention.resolve'])
      UNION ALL
      SELECT unnest(array['cashier', 'waiter', 'kitchen', 'driver']), 'tenant.view'
    ), limits(permission, roles) AS (
      VALUES ('tenant.view', array['owner', 'manager', 'cashier', 'waiter', 'kitchen', 'driver']),
        ('tenant.profile.edit', array['owner']),
        ('branch.settings.edit', array['owner', 'manager']),
        ('branch.hours.edit', array['owner', 'manager']),
        ('branch.security.edit', array['owner', 'manager']),
        ('staff.view', array['owner', 'manager']),
        ('staff.manage', array['owner', 'manager']),
        ('staff.permissions.adjust', array['owner']),
        ('devices.manage', array['owner', 'manager']),
        ('backoffice.remote', array['owner', 'manager']),
        ('hub.manage', array['owner', 'manager']),
        ('sync.attention.resolve', array['owner', 'manager']),
        ('sync.quarantine.review', array['owner'])
    ), owner_locked(permission) AS (
      SELECT unnest(array['tenant.view', 'tenant.profile.edit', 'staff.view', 'staff.manage',
        'staff.permissions.adjust', 'devices.manage', 'backoffice.remote'])
    ), held(membership_id, permission) AS (
      SELECT m.id, p.permission
      FROM staff_memberships m
      JOIN presets p ON p.role = ANY (m.roles)
      UNION
      SELECT m.id, unnest(m.granted_permissions) FROM staff_memberships m
    ), effective(membership_id, permissions) AS (
      SELECT m.id,
        coalesce(array_agg(c.permission ORDER BY c.position) FILTER (WHERE c.permission IS NOT NULL),
          '{}'::text[])
      FROM staff_memberships m
      LEFT JOIN catalog c ON (
        (
          (EXISTS (SELECT 1 FROM held h WHERE h.membership_id = m.id AND h.permission = c.permission)
            AND NOT c.permission = ANY (m.revoked_permissions))
          OR ('owner' = ANY (m.roles) AND c.permission IN (SELECT permission FROM owner_locked))
        )
        AND EXISTS (SELECT 1 FROM limits l WHERE l.permission = c.permission AND l.roles && m.roles)
      )
      GROUP BY m.id
    )
    INSERT INTO membership_access_snapshots
      (id, tenant_id, membership_id, status, roles, all_branches, branch_ids, permissions,
       effective_from)
    SELECT
      -- A UUIDv7: the millisecond time over a random UUID, version bits set to 7.
      encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) PLACING
        substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
        FROM 1 FOR 6), 52, 1), 53, 1), 'hex')::uuid,
      m.tenant_id, m.id, m.status, m.roles, m.all_branches,
      CASE WHEN m.all_branches THEN '{}'::uuid[] ELSE coalesce((
        SELECT array_agg(b.branch_id ORDER BY b.branch_id) FROM staff_membership_branches b
        WHERE b.membership_id = m.id AND b.archived_at IS NULL), '{}'::uuid[]) END,
      e.permissions,
      m.created_at
    FROM staff_memberships m
    JOIN effective e ON e.membership_id = m.id;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
--> statement-breakpoint

-- The sync service (ADR 0022, 0035): it reads whole rows of the published tables (its snapshot is
-- SELECT *), so nothing it must not read is in them: payloads are in command_payloads and CA keys in
-- branch_ca_keys, neither published. The stream definitions in packages/sync/powersync select the
-- columns each device gets, filtered by tenant_id and branch_id. Never FOR ALL TABLES.
CREATE PUBLICATION powersync FOR TABLE tenants, branches, devices, device_certificates,
  branch_certificate_authorities, command_log, attention_items, attention_resolutions;
--> statement-breakpoint
GRANT SELECT ON tenants, branches, devices, device_certificates, branch_certificate_authorities,
  command_log, attention_items, attention_resolutions TO food_sync;
