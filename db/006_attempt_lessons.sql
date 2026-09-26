-- =====================================================================
-- Trader Academy Platform  ·  Module 3b  ·  One open paper, one lesson
--
-- A knowledge-check attempt now records the lesson it was drawn for,
-- instead of leaving that to be inferred from how its questions happen
-- to be tagged. Progress and the North Star key are built on it.
--
-- And a learner holds at most one open paper at a time: one placement
-- paper, and one check paper per lesson. Two concurrent draws used to
-- create two; now the second insert conflicts and is handed the first.
-- =====================================================================

ALTER TABLE app.quiz_attempts
  ADD COLUMN IF NOT EXISTS lesson_id uuid NULL REFERENCES platform.lessons(id) ON DELETE SET NULL;

-- Existing check attempts take the lesson of their first question, which
-- is how they were drawn: every question on a check paper comes from one
-- lesson.
UPDATE app.quiz_attempts a
   SET lesson_id = q.lesson_id
  FROM platform.questions q
 WHERE a.kind = 'knowledge_check'
   AND a.lesson_id IS NULL
   AND q.id = a.question_ids[1];

-- New check attempts must name their lesson. NOT VALID leaves any old row
-- whose question has since been deleted alone rather than failing here.
DO $$ BEGIN
  ALTER TABLE app.quiz_attempts
    ADD CONSTRAINT ck_attempts_check_lesson
    CHECK (kind <> 'knowledge_check' OR lesson_id IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Duplicate open papers left by the race would block the indexes below.
-- An open paper holds no answers, so keeping the newest loses nothing.
DELETE FROM app.quiz_attempts a
 USING app.quiz_attempts newer
 WHERE a.submitted_at IS NULL AND newer.submitted_at IS NULL
   AND a.user_id = newer.user_id AND a.kind = newer.kind
   AND a.lesson_id IS NOT DISTINCT FROM newer.lesson_id
   AND (a.started_at, a.id) < (newer.started_at, newer.id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attempts_open_placement
  ON app.quiz_attempts (user_id)
  WHERE kind = 'placement' AND submitted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_attempts_open_check
  ON app.quiz_attempts (user_id, lesson_id)
  WHERE kind = 'knowledge_check' AND submitted_at IS NULL;
