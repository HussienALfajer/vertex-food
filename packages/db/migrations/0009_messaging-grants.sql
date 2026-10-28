-- WhatsApp messaging (spec S03, ADR 0034): platform tables, no tenant data, so no RLS. Each
-- revokes PUBLIC and grants the app role (the API, the gateway and later the worker) only what
-- the spec lists, column by column where a column must never change. The jobs role gets nothing.

REVOKE ALL ON whatsapp_sessions, whatsapp_session_credentials, whatsapp_session_events,
  whatsapp_messages, whatsapp_known_recipients, whatsapp_opt_outs FROM PUBLIC;
--> statement-breakpoint

-- whatsapp_sessions: business; unlinked sessions are archived, never deleted.
GRANT SELECT, INSERT ON whatsapp_sessions TO food_app;
--> statement-breakpoint
GRANT UPDATE (label, phone, state, paused_at, pause_reason, linked_at, qr_sealed, qr_expires_at,
  link_deadline_at, last_connected_at, last_disconnect_reason, consecutive_failures, lease_holder,
  lease_expires_at, updated_at, archived_at)
  ON whatsapp_sessions TO food_app;
--> statement-breakpoint

-- whatsapp_session_credentials: Baileys' store; deleted on re-link and unlink.
GRANT SELECT, INSERT, DELETE ON whatsapp_session_credentials TO food_app;
--> statement-breakpoint
GRANT UPDATE (value_sealed, updated_at) ON whatsapp_session_credentials TO food_app;
--> statement-breakpoint

-- whatsapp_session_events: append-only for every role.
CREATE TRIGGER whatsapp_session_events_refuse_change BEFORE UPDATE OR DELETE ON whatsapp_session_events
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER whatsapp_session_events_refuse_truncate BEFORE TRUNCATE ON whatsapp_session_events
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
GRANT SELECT, INSERT ON whatsapp_session_events TO food_app;
--> statement-breakpoint

-- whatsapp_messages: the send queue; what a message is (kind, template, recipient, challenge,
-- source event, deadline) never changes; the gateway's sweep deletes rows after 30 days and an
-- unlink deletes the session's queued messages.
GRANT SELECT, INSERT, DELETE ON whatsapp_messages TO food_app;
--> statement-breakpoint
GRANT UPDATE (session_id, recipient_sealed, params_sealed, body_sealed, status, failure_reason,
  attempts, first_contact, next_attempt_at, transport_message_id, sent_at, delivered_at, read_at,
  updated_at)
  ON whatsapp_messages TO food_app;
--> statement-breakpoint

-- whatsapp_known_recipients: derived from sends, deleted with the session's credentials.
GRANT SELECT, INSERT, DELETE ON whatsapp_known_recipients TO food_app;
--> statement-breakpoint
GRANT UPDATE (last_sent_at, last_auto_reply_at, updated_at)
  ON whatsapp_known_recipients TO food_app;
--> statement-breakpoint

-- whatsapp_opt_outs: business; a person's choice is kept with its times, never deleted.
GRANT SELECT, INSERT ON whatsapp_opt_outs TO food_app;
--> statement-breakpoint
GRANT UPDATE (opted_out_at, opted_in_at, last_keyword_at, updated_at)
  ON whatsapp_opt_outs TO food_app;
