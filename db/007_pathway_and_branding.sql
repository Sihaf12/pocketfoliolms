-- =====================================================================
-- Trader Academy Platform  ·  Module 4a  ·  Pathway rules and branding
--
-- Everything the client used to compute for itself now has a home here,
-- so the browser only displays what the server decided:
--   platform.lesson_prerequisites   which lessons open which
--   platform.lessons.xp             experience points for a verified lesson
--   platform.lessons.experience     an interactive exercise, if the lesson has one
--   app.users.goal, daily_minutes   the onboarding answers that are not ratings
--   app.current_tenant_brand()      the academy's own name and brand tokens
-- =====================================================================

-- ---------------------------------------------------------------------
-- Lesson prerequisites. A lesson opens once every lesson it requires has
-- a passed knowledge check. Requirements may cross courses: Position
-- sizing needs both Reading a chart and Leverage and margin.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.lesson_prerequisites (
  lesson_id          uuid NOT NULL REFERENCES platform.lessons(id) ON DELETE CASCADE,
  requires_lesson_id uuid NOT NULL REFERENCES platform.lessons(id) ON DELETE CASCADE,
  PRIMARY KEY (lesson_id, requires_lesson_id),
  CONSTRAINT ck_prerequisite_not_self CHECK (lesson_id <> requires_lesson_id)
);
CREATE INDEX IF NOT EXISTS ix_prerequisites_requires ON platform.lesson_prerequisites (requires_lesson_id);

GRANT SELECT ON platform.lesson_prerequisites TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.lesson_prerequisites TO app_control;

ALTER TABLE platform.lesson_prerequisites ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lesson_prerequisites FORCE  ROW LEVEL SECURITY;

-- A link is visible only when both of its lessons are, by the course rule
-- from 003, so it cannot reveal a lesson id from another academy's
-- private course.
DROP POLICY IF EXISTS tenant_visibility ON platform.lesson_prerequisites;
CREATE POLICY tenant_visibility ON platform.lesson_prerequisites
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id
             WHERE l.id = lesson_prerequisites.lesson_id
               AND (c.owner_tenant_id IS NULL OR c.owner_tenant_id = app.current_tenant()))
    AND
    EXISTS (SELECT 1 FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id
             WHERE l.id = lesson_prerequisites.requires_lesson_id
               AND (c.owner_tenant_id IS NULL OR c.owner_tenant_id = app.current_tenant()))
  );

DROP POLICY IF EXISTS control_plane ON platform.lesson_prerequisites;
CREATE POLICY control_plane ON platform.lesson_prerequisites
  TO app_control USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- Lesson extras.
-- ---------------------------------------------------------------------
ALTER TABLE platform.lessons ADD COLUMN IF NOT EXISTS xp integer NOT NULL DEFAULT 0;
ALTER TABLE platform.lessons ADD COLUMN IF NOT EXISTS experience text NULL;

DO $$ BEGIN
  ALTER TABLE platform.lessons ADD CONSTRAINT ck_lessons_xp CHECK (xp >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE platform.lessons
    ADD CONSTRAINT ck_lessons_experience CHECK (experience IS NULL OR experience IN ('leverage_simulator'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- Onboarding answers beyond the self-rating.
-- ---------------------------------------------------------------------
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS goal text NULL;
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS daily_minutes smallint NULL;

DO $$ BEGIN
  ALTER TABLE app.users ADD CONSTRAINT ck_users_goal
    CHECK (goal IS NULL OR goal IN ('new', 'some_experience', 'stop_losing', 'go_deeper'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE app.users ADD CONSTRAINT ck_users_daily_minutes
    CHECK (daily_minutes IS NULL OR daily_minutes IN (10, 20, 30));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- The learner's events, newest first, read by GET /me/events. Every
-- event the request path emits is partitioned by the learner's id.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_outbox_partition
  ON app.outbox_events (tenant_id, partition_key, created_at DESC);

-- Events written in one transaction used to share now(), so their order
-- was lost. clock_timestamp() records when each row was written.
ALTER TABLE app.outbox_events ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- ---------------------------------------------------------------------
-- Branding for the academy in scope, and only that one.
--
-- app_user has no access to app.tenants (005). This returns the name and
-- brand of app.current_tenant() and nothing else: no id, no domain, no
-- CRM settings, and no row at all when no tenant is in scope. Locked
-- down like the 005 functions.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_tenant_brand()
RETURNS TABLE (name text, brand jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT t.name, t.brand
    FROM app.tenants t
   WHERE t.id = app.current_tenant()
     AND t.status = 'active'
$$;

REVOKE ALL ON FUNCTION app.current_tenant_brand() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_tenant_brand() TO app_user;
