-- =====================================================================
-- Trader Academy Platform  ·  Module 1b  ·  Isolation and integrity
--
-- The boundary lives here rather than in application code. If a query
-- ever arrives without a tenant, it returns zero rows. It does not throw
-- and it does not fall back to everything.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tenant resolver.
--
-- current_setting(..., true) returns NULL when the setting was never
-- applied. NULLIF turns an empty string into NULL as well, so a blank
-- value cannot raise an invalid-uuid error inside a policy. Every
-- comparison against NULL is unknown, which excludes the row.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_actor() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.actor', true), ''), 'system')
$$;

-- ---------------------------------------------------------------------
-- Application role. No BYPASSRLS, so policies apply without exception.
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE ROLE app_user LOGIN PASSWORD 'change_me_in_deployment';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA app, platform TO app_user;
GRANT SELECT ON ALL TABLES IN SCHEMA platform TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT SELECT ON TABLES TO app_user;

-- ---------------------------------------------------------------------
-- Enable and FORCE row-level security on every tenant-owned table.
-- FORCE matters: without it the table owner silently bypasses policies,
-- which is exactly the case that leaks in production.
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','users','tenant_catalogues','learning_paths','enrolments',
    'quiz_attempts','certificates','assistant_dialogs','system_audit_log','outbox_events'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE  ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Policies. One shape, applied consistently.
--   USING       controls which rows are visible to SELECT/UPDATE/DELETE
--   WITH CHECK  stops a write from planting a row in another tenant
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','tenant_catalogues','learning_paths','enrolments',
    'quiz_attempts','certificates','assistant_dialogs','system_audit_log','outbox_events'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON app.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON app.%I
        USING      (tenant_id = app.current_tenant())
        WITH CHECK (tenant_id = app.current_tenant())
    $f$, t);
  END LOOP;
END $$;

-- The tenants table keys on id rather than tenant_id.
DROP POLICY IF EXISTS tenant_isolation ON app.tenants;
CREATE POLICY tenant_isolation ON app.tenants
  USING      (id = app.current_tenant())
  WITH CHECK (id = app.current_tenant());

-- ---------------------------------------------------------------------
-- Control-plane role, used only by provisioning and the outbox relay,
-- both of which legitimately work across tenants. Kept separate so the
-- request path can never acquire it.
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE ROLE app_control LOGIN PASSWORD 'change_me_in_deployment';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA app, platform TO app_control;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_control;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA platform TO app_control;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_control;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','users','tenant_catalogues','learning_paths','enrolments',
    'quiz_attempts','certificates','assistant_dialogs','system_audit_log','outbox_events'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS control_plane ON app.%I', t);
    EXECUTE format($f$
      CREATE POLICY control_plane ON app.%I TO app_control USING (true) WITH CHECK (true)
    $f$, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Audit log: append only, hash chained per tenant.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.audit_append(
  p_actor text, p_action text, p_entity_type text,
  p_entity_id text, p_payload jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_seq    bigint;
  v_prev   text;
  v_hash   text;
  v_id     bigint;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'audit_append requires app.tenant_id to be set';
  END IF;

  SELECT COALESCE(MAX(seq), 0) + 1,
         COALESCE((SELECT hash FROM app.system_audit_log
                    WHERE tenant_id = v_tenant ORDER BY seq DESC LIMIT 1),
                  repeat('0', 64))
    INTO v_seq, v_prev
    FROM app.system_audit_log
   WHERE tenant_id = v_tenant;

  v_hash := encode(digest(
      v_prev || '|' || v_tenant::text || '|' || v_seq::text || '|' ||
      p_actor || '|' || p_action || '|' || p_entity_type || '|' ||
      COALESCE(p_entity_id,'') || '|' || p_payload::text, 'sha256'), 'hex');

  INSERT INTO app.system_audit_log
    (tenant_id, seq, actor, action, entity_type, entity_id, payload, prev_hash, hash)
  VALUES (v_tenant, v_seq, p_actor, p_action, p_entity_type, p_entity_id, p_payload, v_prev, v_hash)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- Block mutation of history even for the owning role.
CREATE OR REPLACE FUNCTION app.audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'system_audit_log is append only (attempted %)', TG_OP;
END $$;

DROP TRIGGER IF EXISTS trg_audit_immutable ON app.system_audit_log;
CREATE TRIGGER trg_audit_immutable
  BEFORE UPDATE OR DELETE ON app.system_audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_immutable();

-- Verify a tenant's chain. Returns the first sequence number that breaks.
CREATE OR REPLACE FUNCTION app.audit_verify(p_tenant uuid)
RETURNS TABLE (ok boolean, broken_at bigint, checked bigint)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r record; v_prev text := repeat('0', 64); v_calc text; v_n bigint := 0;
BEGIN
  FOR r IN SELECT * FROM app.system_audit_log
            WHERE tenant_id = p_tenant ORDER BY seq ASC LOOP
    v_calc := encode(digest(
        v_prev || '|' || r.tenant_id::text || '|' || r.seq::text || '|' ||
        r.actor || '|' || r.action || '|' || r.entity_type || '|' ||
        COALESCE(r.entity_id,'') || '|' || r.payload::text, 'sha256'), 'hex');
    v_n := v_n + 1;
    IF v_calc <> r.hash OR r.prev_hash <> v_prev THEN
      RETURN QUERY SELECT false, r.seq, v_n; RETURN;
    END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN QUERY SELECT true, NULL::bigint, v_n;
END $$;

-- ---------------------------------------------------------------------
-- Outbox helpers.
--
-- enqueue() is called inside the caller's transaction, never on its own.
-- claim_batch() is called by the relay under the control-plane role and
-- takes a fair share per tenant, so one academy running a campaign
-- cannot starve the rest of the queue.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.outbox_enqueue(
  p_event_type text, p_payload jsonb, p_idempotency_key text, p_partition_key text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_tenant uuid := app.current_tenant(); v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'outbox_enqueue requires app.tenant_id to be set';
  END IF;
  INSERT INTO app.outbox_events (tenant_id, event_type, payload, idempotency_key, partition_key)
  VALUES (v_tenant, p_event_type, p_payload, p_idempotency_key, p_partition_key)
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION app.outbox_claim_batch(
  p_worker text, p_per_tenant integer DEFAULT 4, p_total integer DEFAULT 50
) RETURNS SETOF app.outbox_events
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT e.id,
           row_number() OVER (PARTITION BY e.tenant_id ORDER BY e.available_at, e.created_at) AS rn
      FROM app.outbox_events e
      JOIN app.tenants t ON t.id = e.tenant_id AND t.status = 'active'
     WHERE e.status IN ('pending','failed')
       AND e.available_at <= now()
  ),
  picked AS (
    SELECT id FROM ranked
     WHERE rn <= p_per_tenant
     LIMIT p_total
  )
  UPDATE app.outbox_events o
     SET status = 'in_flight', locked_at = now(), locked_by = p_worker
   WHERE o.id IN (SELECT id FROM picked)
     AND o.status IN ('pending','failed')
  RETURNING o.*;
END $$;

CREATE OR REPLACE FUNCTION app.outbox_settle(
  p_id uuid, p_ok boolean, p_error text DEFAULT NULL, p_max_attempts integer DEFAULT 5
) RETURNS app.outbox_status
LANGUAGE plpgsql AS $$
DECLARE v_status app.outbox_status; v_retries smallint;
BEGIN
  IF p_ok THEN
    UPDATE app.outbox_events
       SET status='delivered', delivered_at=now(), locked_at=NULL, locked_by=NULL, last_error=NULL
     WHERE id=p_id RETURNING status INTO v_status;
    RETURN v_status;
  END IF;

  SELECT retry_count + 1 INTO v_retries FROM app.outbox_events WHERE id = p_id;

  UPDATE app.outbox_events
     SET retry_count = v_retries,
         status      = (CASE WHEN v_retries >= p_max_attempts THEN 'dead' ELSE 'failed' END)::app.outbox_status,
         -- Exponential backoff: 2s, 4s, 8s, 16s, 32s.
         available_at= now() + (power(2, LEAST(v_retries,6)) || ' seconds')::interval,
         locked_at   = NULL,
         locked_by   = NULL,
         last_error  = p_error
   WHERE id = p_id
   RETURNING status INTO v_status;
  RETURN v_status;
END $$;

-- Reclaim anything a crashed worker left locked.
CREATE OR REPLACE FUNCTION app.outbox_reap(p_stale_seconds integer DEFAULT 120)
RETURNS integer LANGUAGE sql AS $$
  WITH r AS (
    UPDATE app.outbox_events
       SET status='pending', locked_at=NULL, locked_by=NULL
     WHERE status='in_flight'
       AND locked_at < now() - (p_stale_seconds || ' seconds')::interval
    RETURNING 1)
  SELECT COALESCE(count(*),0)::integer FROM r;
$$;
