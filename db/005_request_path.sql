-- =====================================================================
-- Trader Academy Platform  ·  Module 3a  ·  Request path support
--
-- What the REST routes need from the database before a tenant is known:
--   app.resolve_tenant()      host -> tenant id, the only way in
--   app.verify_certificate()  public verification, no tenant at all
--   app.sessions              login sessions, isolated per tenant
--
-- Both functions are SECURITY DEFINER, so they read through RLS. Each is
-- held to one exact lookup, returns the least it can, pins search_path
-- and is executable by app_user alone.
--
-- They must be owned by a role that bypasses RLS (the migration owner).
-- Under FORCE ROW LEVEL SECURITY a non-bypassing owner would see nothing,
-- and every host would resolve to no academy. That fails safe, not open.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tenant resolution.
--
-- Exact match on the normalised host, active academies only. No LIKE, no
-- suffix match, no default: a host that is not an academy's primary
-- domain resolves to NULL, and the route answers 404.
-- ---------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE app.tenants
    ADD CONSTRAINT ck_tenants_domain_lower CHECK (primary_domain = lower(primary_domain));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION app.resolve_tenant(p_host text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT t.id
    FROM app.tenants t
   WHERE t.primary_domain = lower(p_host)
     AND t.status = 'active'
$$;

REVOKE ALL ON FUNCTION app.resolve_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_tenant(text) TO app_user;

-- With resolution going through the function, the request role has no
-- reason to read or write tenant rows, and CRM secrets live there.
REVOKE ALL ON app.tenants FROM app_user;

-- ---------------------------------------------------------------------
-- Public certificate verification.
--
-- Returns holder, course and issue date, nothing that identifies the
-- academy. Revoked and expired certificates return no row, exactly like
-- an unknown serial.
-- ---------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE app.certificates
    ADD CONSTRAINT ck_certificates_serial
    CHECK (serial ~ '^PA-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION app.verify_certificate(p_serial text)
RETURNS TABLE (holder_name text, course_title text, issued_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT c.holder_name, c.course_title, c.issued_at
    FROM app.certificates c
   WHERE c.serial = p_serial
     AND c.revoked_at IS NULL
     AND (c.expires_at IS NULL OR c.expires_at > now())
$$;

REVOKE ALL ON FUNCTION app.verify_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.verify_certificate(text) TO app_user;

-- ---------------------------------------------------------------------
-- Sessions. A tenant table like any other, so a token issued on one
-- academy's host does not exist when read under another's.
-- Only a hash of the token is stored.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz NULL,
  CONSTRAINT uq_sessions_token UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON app.sessions (tenant_id, user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.sessions TO app_user, app_control;

ALTER TABLE app.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sessions FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON app.sessions;
CREATE POLICY tenant_isolation ON app.sessions
  USING      (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

DROP POLICY IF EXISTS control_plane ON app.sessions;
CREATE POLICY control_plane ON app.sessions TO app_control USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- Introducing broker attribution, held from signup until the learner's
-- first enrolment copies it onto the enrolment row.
-- ---------------------------------------------------------------------
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS ib_ref_code text NULL;
