-- =====================================================================
-- Trader Academy Platform  ·  Module 1c  ·  Private platform content
--
-- platform.courses.owner_tenant_id marks a course as belonging to one
-- academy. Until now nothing enforced that: platform.* had no RLS and
-- app_user could read all of it, so every broker could read every other
-- broker's private courses, lessons and questions.
--
-- A course is visible when it is platform-owned (owner_tenant_id IS NULL)
-- or owned by the tenant in scope. Lessons and questions follow their
-- course. With no tenant in scope, only platform-owned content is visible.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enable and FORCE, for the same reason as 002: without FORCE the table
-- owner silently bypasses the policies.
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['courses','lessons','questions'] LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform.%I FORCE  ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Read policies. app_user holds only SELECT on platform.*, so these are
-- the whole of its access. Lessons and questions restate the course rule
-- rather than lean on RLS applying inside the subquery, so each policy
-- can be read on its own.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_visibility ON platform.courses;
CREATE POLICY tenant_visibility ON platform.courses
  FOR SELECT
  USING (owner_tenant_id IS NULL OR owner_tenant_id = app.current_tenant());

DROP POLICY IF EXISTS tenant_visibility ON platform.lessons;
CREATE POLICY tenant_visibility ON platform.lessons
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM platform.courses c
     WHERE c.id = lessons.course_id
       AND (c.owner_tenant_id IS NULL OR c.owner_tenant_id = app.current_tenant())
  ));

DROP POLICY IF EXISTS tenant_visibility ON platform.questions;
CREATE POLICY tenant_visibility ON platform.questions
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM platform.courses c
     WHERE c.id = questions.course_id
       AND (c.owner_tenant_id IS NULL OR c.owner_tenant_id = app.current_tenant())
  ));

-- ---------------------------------------------------------------------
-- The control plane authors and publishes content for every academy, so
-- it keeps full access.
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['courses','lessons','questions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS control_plane ON platform.%I', t);
    EXECUTE format($f$
      CREATE POLICY control_plane ON platform.%I TO app_control USING (true) WITH CHECK (true)
    $f$, t);
  END LOOP;
END $$;
