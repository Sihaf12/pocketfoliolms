-- =====================================================================
-- Trader Academy Platform  ·  Module 4a  ·  Course entitlements
--
-- Which platform courses each academy may offer. The platform sets the
-- list from the console; an academy's admin then switches each allowed
-- course on or off in the catalogue. An academy's own private courses
-- need no entitlement: they are its own.
--
--   app.tenant_entitlements   one row per (academy, platform course) allowed
--
-- The database holds the rule, not the API:
--   * a catalogue row cannot switch a platform course on without an
--     entitlement, whoever writes it;
--   * removing an entitlement switches the course off in that academy's
--     catalogue, in the same statement;
--   * only a platform course can be an entitlement.
--
-- Every academy that exists when this runs is allowed every published
-- platform course, so nothing changes until the platform changes it.
-- Idempotent, like every migration here.
-- =====================================================================

CREATE TABLE IF NOT EXISTS app.tenant_entitlements (
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES platform.courses(id) ON DELETE CASCADE,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  -- Who allowed it: staff:<id> from the console, or how it came about.
  granted_by  text NOT NULL DEFAULT 'migration',
  PRIMARY KEY (tenant_id, course_id)
);

ALTER TABLE app.tenant_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant_entitlements FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON app.tenant_entitlements;
CREATE POLICY tenant_isolation ON app.tenant_entitlements
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
DROP POLICY IF EXISTS console_access ON app.tenant_entitlements;
CREATE POLICY console_access ON app.tenant_entitlements TO app_console USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS control_plane ON app.tenant_entitlements;
CREATE POLICY control_plane ON app.tenant_entitlements TO app_control USING (true) WITH CHECK (true);

-- An academy reads its own list; only the platform changes it. The
-- schema's default privileges (002) would give app_user writes: taken back.
REVOKE ALL ON app.tenant_entitlements FROM PUBLIC, app_user, app_studio;
GRANT SELECT ON app.tenant_entitlements TO app_user, app_studio;
GRANT SELECT, INSERT, DELETE ON app.tenant_entitlements TO app_console, app_control;

-- Only a platform course is something to be allowed.
CREATE OR REPLACE FUNCTION app.entitlement_is_platform_course()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.courses WHERE id = NEW.course_id AND owner_tenant_id IS NULL) THEN
    RAISE EXCEPTION 'only a platform course can be allowed to an academy' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.entitlement_is_platform_course() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_entitlement_platform_course ON app.tenant_entitlements;
CREATE TRIGGER trg_entitlement_platform_course
  BEFORE INSERT OR UPDATE ON app.tenant_entitlements
  FOR EACH ROW EXECUTE FUNCTION app.entitlement_is_platform_course();

-- A platform course is switched on in a catalogue only if the academy is allowed it.
CREATE OR REPLACE FUNCTION app.catalogue_needs_entitlement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.enabled
     AND EXISTS (SELECT 1 FROM platform.courses WHERE id = NEW.course_id AND owner_tenant_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM app.tenant_entitlements e WHERE e.tenant_id = NEW.tenant_id AND e.course_id = NEW.course_id) THEN
    RAISE EXCEPTION 'this academy is not allowed that course' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.catalogue_needs_entitlement() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_catalogue_needs_entitlement ON app.tenant_catalogues;
CREATE TRIGGER trg_catalogue_needs_entitlement
  BEFORE INSERT OR UPDATE ON app.tenant_catalogues
  FOR EACH ROW EXECUTE FUNCTION app.catalogue_needs_entitlement();

-- Taking a course away switches it off in that academy's catalogue at once.
CREATE OR REPLACE FUNCTION app.entitlement_removed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE app.tenant_catalogues SET enabled = false
   WHERE tenant_id = OLD.tenant_id AND course_id = OLD.course_id AND enabled;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION app.entitlement_removed() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_entitlement_removed ON app.tenant_entitlements;
CREATE TRIGGER trg_entitlement_removed
  AFTER DELETE ON app.tenant_entitlements
  FOR EACH ROW EXECUTE FUNCTION app.entitlement_removed();

-- Nothing changes for any academy that exists now: each is allowed every
-- published platform course, and any platform course already on in its catalogue.
INSERT INTO app.tenant_entitlements (tenant_id, course_id, granted_by)
SELECT t.id, c.id, 'migration'
  FROM app.tenants t
 CROSS JOIN platform.courses c
 WHERE c.owner_tenant_id IS NULL AND c.review_state = 'published'
ON CONFLICT DO NOTHING;

INSERT INTO app.tenant_entitlements (tenant_id, course_id, granted_by)
SELECT tc.tenant_id, tc.course_id, 'migration'
  FROM app.tenant_catalogues tc JOIN platform.courses c ON c.id = tc.course_id
 WHERE c.owner_tenant_id IS NULL AND tc.enabled
ON CONFLICT DO NOTHING;
