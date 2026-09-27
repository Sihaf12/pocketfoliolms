-- =====================================================================
-- Trader Academy Platform  ·  Google sign-in for learners
--
-- One platform-owned callback host serves every academy, so a sign-in
-- that starts on an academy's host has to carry its academy with it:
--
--   app.sso_states    started on an academy's host: which academy, the
--                     PKCE verifier and nonce, and a binding to the
--                     browser. Single use, ten minutes.
--   app.sso_handoffs  written by the callback for the academy the state
--                     named: a code the academy's own host turns into a
--                     learner session. Single use, sixty seconds.
--
-- Both are tenant tables: RLS enabled and forced. The request role may
-- insert a state for the academy in scope and never read one back; the
-- callback, which has no academy yet, takes a state only through
-- app.sso_state_take(), holding the state's own random value. A handoff
-- is redeemed under the redeeming host's RLS, so a code carried to
-- another academy finds nothing there.
--
-- app.users.sso_subject holds '<provider>:<subject>', unique per academy.
-- Idempotent, like every migration here.
-- =====================================================================

CREATE TABLE IF NOT EXISTS app.sso_states (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  state_hash    text NOT NULL UNIQUE,
  code_verifier text NOT NULL,
  nonce         text NOT NULL,
  binding_hash  text NOT NULL,
  ib_ref_code   text NULL,
  return_to     text NULL CHECK (return_to IS NULL OR (return_to LIKE '/%' AND return_to NOT LIKE '//%')),
  origin        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);

CREATE TABLE IF NOT EXISTS app.sso_handoffs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  code_hash     text NOT NULL UNIQUE,
  user_id       uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  binding_hash  text NOT NULL,
  return_to     text NULL CHECK (return_to IS NULL OR (return_to LIKE '/%' AND return_to NOT LIKE '//%')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '60 seconds',
  used_at       timestamptz NULL
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sso_states', 'sso_handoffs'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON app.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON app.%I
        USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant())
    $f$, t);
    EXECUTE format('DROP POLICY IF EXISTS control_plane ON app.%I', t);
    EXECUTE format('CREATE POLICY control_plane ON app.%I TO app_control USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- A state holds a PKCE verifier: the request role writes it and never reads it.
-- The schema's default privileges (002) would allow more; they are taken back.
REVOKE ALL ON app.sso_states, app.sso_handoffs FROM PUBLIC, app_user, app_studio;
GRANT INSERT ON app.sso_states TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.sso_handoffs TO app_user;
GRANT SELECT, DELETE ON app.sso_states, app.sso_handoffs TO app_control;

-- A Google identity belongs to one learner per academy.
DROP INDEX IF EXISTS app.ix_users_tenant_sso;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_sso ON app.users (tenant_id, sso_subject) WHERE sso_subject IS NOT NULL;

-- The callback's one way to a state: delete it and hand it back, once.
-- An expired state is still handed back, flagged, so the learner can be
-- returned to their academy with a reason; it is gone either way. Some
-- long-expired states of any academy are cleared on the way.
CREATE OR REPLACE FUNCTION app.sso_state_take(p_state_hash text)
RETURNS TABLE (tenant_id uuid, code_verifier text, nonce text, binding_hash text,
               ib_ref_code text, return_to text, origin text, expired boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  DELETE FROM app.sso_states s
   WHERE s.id IN (SELECT x.id FROM app.sso_states x WHERE x.expires_at < now() - interval '1 hour' LIMIT 100);
  RETURN QUERY
    WITH taken AS (
      DELETE FROM app.sso_states s WHERE s.state_hash = p_state_hash
      RETURNING s.tenant_id, s.code_verifier, s.nonce, s.binding_hash, s.ib_ref_code, s.return_to, s.origin,
                s.expires_at <= now() AS expired)
    SELECT * FROM taken;
END $$;

REVOKE ALL ON FUNCTION app.sso_state_take(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sso_state_take(text) TO app_user;
