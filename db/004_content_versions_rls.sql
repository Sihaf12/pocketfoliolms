-- =====================================================================
-- Trader Academy Platform  ·  Module 1d  ·  Private version history
--
-- 003 hid private courses, lessons and questions, but their version
-- snapshots in platform.content_versions stayed readable by every academy,
-- so a private course leaked through its own history.
--
-- A snapshot is visible when the course it traces back to is visible:
-- a course by its own id, a lesson or question through its course_id.
-- Glossary terms have no owner and stay visible to all. A snapshot whose
-- entity no longer exists resolves to no course and is hidden.
-- =====================================================================

ALTER TABLE platform.content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.content_versions FORCE  ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- Read policy. The course rule is restated rather than left to RLS on
-- the lessons and questions subqueries, matching 003, so the policy can
-- be read on its own.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_visibility ON platform.content_versions;
CREATE POLICY tenant_visibility ON platform.content_versions
  FOR SELECT
  USING (
    entity_type = 'glossary_term'
    OR EXISTS (
      SELECT 1 FROM platform.courses c
       WHERE (c.owner_tenant_id IS NULL OR c.owner_tenant_id = app.current_tenant())
         AND c.id = CASE content_versions.entity_type
               WHEN 'course'   THEN content_versions.entity_id
               WHEN 'lesson'   THEN (SELECT l.course_id FROM platform.lessons l
                                      WHERE l.id = content_versions.entity_id)
               WHEN 'question' THEN (SELECT q.course_id FROM platform.questions q
                                      WHERE q.id = content_versions.entity_id)
             END
    )
  );

-- The control plane writes version history for every academy.
DROP POLICY IF EXISTS control_plane ON platform.content_versions;
CREATE POLICY control_plane ON platform.content_versions
  TO app_control USING (true) WITH CHECK (true);
