-- Identity, access and devices (spec S02): isolation of the tenant tables, the access of the app
-- role to every new table, the append-only used tokens and the guards the rules need.

-- Tenant tables: forced RLS and the one tenant_isolation policy (ADR 0004).
ALTER TABLE staff_memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE staff_memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON staff_memberships
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE staff_membership_branches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE staff_membership_branches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON staff_membership_branches
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE devices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON devices
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE staff_pins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE staff_pins FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON staff_pins
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE staff_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE staff_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON staff_sessions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

-- The app role: what each table needs, column by column where a column must never change. No
-- DELETE anywhere: records are archived, ended or revoked (ADR 0016).
REVOKE ALL ON accounts, account_tenant_links, staff_memberships, staff_membership_branches,
  devices, staff_pins, staff_sessions, personal_devices, otp_challenges, used_tokens,
  platform_users, platform_user_recovery_codes, platform_sessions FROM PUBLIC;
--> statement-breakpoint
-- accounts: platform data reached only through the identity module; the id never changes.
GRANT SELECT, INSERT ON accounts TO food_app;
--> statement-breakpoint
GRANT UPDATE (phone, name_ar, password_hash, password_changed_at, phone_verified_at,
  password_reset_authorized_until, failed_sign_ins, sign_in_locked_until, updated_at)
  ON accounts TO food_app;
--> statement-breakpoint
-- account_tenant_links: written with the membership it mirrors; the pair never changes.
GRANT SELECT, INSERT ON account_tenant_links TO food_app;
--> statement-breakpoint
GRANT UPDATE (archived_at, updated_at) ON account_tenant_links TO food_app;
--> statement-breakpoint
-- staff_memberships: the account and the tenant never change; who added the member neither.
GRANT SELECT, INSERT ON staff_memberships TO food_app;
--> statement-breakpoint
GRANT UPDATE (status, roles, all_branches, granted_permissions, revoked_permissions, display_name,
  deactivated_at, deactivation_reason, updated_at) ON staff_memberships TO food_app;
--> statement-breakpoint
-- staff_membership_branches: a branch leaves a member's scope by archiving its row.
GRANT SELECT, INSERT ON staff_membership_branches TO food_app;
--> statement-breakpoint
GRANT UPDATE (archived_at, updated_at) ON staff_membership_branches TO food_app;
--> statement-breakpoint
-- devices: the branch, the key and who registered it never change.
GRANT SELECT, INSERT ON devices TO food_app;
--> statement-breakpoint
GRANT UPDATE (name, status, os, app_version, last_seen_at, members_synced_at, revoked_at,
  revoked_by_membership_id, revoke_reason, revoke_note, wiped_at, updated_at) ON devices TO food_app;
--> statement-breakpoint
-- staff_pins: a verifier never changes; a new PIN archives the row and inserts another.
GRANT SELECT, INSERT ON staff_pins TO food_app;
--> statement-breakpoint
GRANT UPDATE (failed_online_attempts, disabled_at, archived_at, updated_at) ON staff_pins TO food_app;
--> statement-breakpoint
-- staff_sessions: the member, the kind and the device never change; the token hash rotates.
GRANT SELECT, INSERT ON staff_sessions TO food_app;
--> statement-breakpoint
GRANT UPDATE (refresh_token_hash, last_refreshed_at, password_verified_at, ended_at, end_reason,
  updated_at) ON staff_sessions TO food_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON personal_devices TO food_app;
--> statement-breakpoint
GRANT UPDATE (last_used_at, expires_at, revoked_at, updated_at) ON personal_devices TO food_app;
--> statement-breakpoint
-- otp_challenges: the code hash and the account never change.
GRANT SELECT, INSERT ON otp_challenges TO food_app;
--> statement-breakpoint
GRANT UPDATE (attempts, consumed_at, delivery_status, expires_at, updated_at) ON otp_challenges
  TO food_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON platform_users TO food_app;
--> statement-breakpoint
GRANT UPDATE (name, role, granted_permissions, revoked_permissions, status, password_hash,
  setup_code_hash, setup_code_expires_at, totp_secret, totp_last_step, failed_sign_ins,
  sign_in_locked_until, updated_at) ON platform_users TO food_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON platform_user_recovery_codes TO food_app;
--> statement-breakpoint
GRANT UPDATE (used_at, archived_at, updated_at) ON platform_user_recovery_codes TO food_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON platform_sessions TO food_app;
--> statement-breakpoint
GRANT UPDATE (last_seen_at, reauthenticated_at, ended_at, end_reason, updated_at)
  ON platform_sessions TO food_app;
--> statement-breakpoint
-- branches: the idle lock (rule 32) joins the columns the app role may change.
GRANT UPDATE (idle_lock_minutes) ON branches TO food_app;
--> statement-breakpoint

-- used_tokens: append-only, so a use is never undone.
CREATE TRIGGER used_tokens_refuse_change BEFORE UPDATE OR DELETE ON used_tokens
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER used_tokens_refuse_truncate BEFORE TRUNCATE ON used_tokens
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
GRANT SELECT, INSERT ON used_tokens TO food_app;
--> statement-breakpoint

-- Rule 19: a revoked device stays revoked, and its revocation is never rewritten; only the wipe
-- confirmation is added afterwards.
CREATE FUNCTION devices_revocation_final() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status = 'revoked'
     AND (NEW.status IS DISTINCT FROM OLD.status
          OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
          OR NEW.revoked_by_membership_id IS DISTINCT FROM OLD.revoked_by_membership_id
          OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason
          OR NEW.revoke_note IS DISTINCT FROM OLD.revoke_note
          OR (OLD.wiped_at IS NOT NULL AND NEW.wiped_at IS DISTINCT FROM OLD.wiped_at)) THEN
    RAISE EXCEPTION 'devices: a revoked device stays revoked'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER devices_revocation_final BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION devices_revocation_final();
--> statement-breakpoint

-- An ended staff or console session never resumes, and its end is never rewritten.
CREATE FUNCTION sessions_end_final() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.ended_at IS NOT NULL
     AND (NEW.ended_at IS DISTINCT FROM OLD.ended_at OR NEW.end_reason IS DISTINCT FROM OLD.end_reason) THEN
    RAISE EXCEPTION '%: an ended session stays ended', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER staff_sessions_end_final BEFORE UPDATE ON staff_sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_end_final();
--> statement-breakpoint
CREATE TRIGGER platform_sessions_end_final BEFORE UPDATE ON platform_sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_end_final();
