-- =====================================================================
-- Demo seed checks. Run by db/tests/demo_seed.sh after loading the seed
-- twice into a throwaway database, so every count below also proves the
-- second load duplicated nothing.
-- =====================================================================
\set ON_ERROR_STOP on
\pset pager off

CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN RAISE NOTICE 'PASS  %', label;
  ELSE RAISE EXCEPTION 'FAIL  %', label; END IF;
END $$;

CREATE TEMP VIEW demo_courses AS
SELECT * FROM platform.courses
 WHERE slug IN ('foundations-of-digital-assets', 'risk-and-protection', 'practical-execution', 'advanced-markets');

CREATE TEMP VIEW demo_lessons AS
SELECT l.*, c.slug AS course_slug, c.tier FROM platform.lessons l JOIN demo_courses c ON c.id = l.course_id;

DO $$
BEGIN
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM app.tenants
      WHERE status = 'active' AND (slug, primary_domain, brand->>'mode') IN (
        ('gtl-academy', 'gtl.academy.test', 'light'),
        ('pocketfolio', 'pocketfolio.academy.test', 'light'),
        ('meridian-inst', 'meridian.academy.test', 'dark'))) = 3,
    'three active academies on their .test hosts, with their modes');

  PERFORM pg_temp.expect(
    (SELECT count(*) FROM app.tenants) = 3,
    'the demo database holds the demo academies and nothing else');

  PERFORM pg_temp.expect(
    (SELECT array_agg(tier::text ORDER BY tier) FROM demo_courses WHERE review_state = 'published' AND owner_tenant_id IS NULL)
      = ARRAY['learn', 'safeguard', 'apply', 'specialise'],
    'four published platform courses, one per tier');

  PERFORM pg_temp.expect(
    (SELECT array_agg(n ORDER BY tier) FROM (SELECT tier, count(*) AS n FROM demo_lessons GROUP BY tier) x)
      = ARRAY[3, 3, 3, 2]::bigint[],
    'eleven lessons: three, three, three and two per tier');

  PERFORM pg_temp.expect(
    NOT EXISTS (SELECT 1 FROM demo_lessons
                 WHERE xp <= 0 OR duration_secs <= 0
                    OR author_name <> 'Draft, Global Tutoring Lab curriculum'
                    OR reviewer_name <> 'Pending compliance review'
                    OR reviewed_at IS NOT NULL),
    'every lesson has XP and a duration, and is marked as an unreviewed draft');

  PERFORM pg_temp.expect(
    NOT EXISTS (SELECT 1 FROM demo_lessons
                 WHERE (SELECT count(*) FROM regexp_matches(body_md, '^## ', 'gn')) < 3
                    OR body_md !~ '\n> \*\*In practice\*\*\n> '
                    OR jsonb_array_length(transcript) < 4),
    'every lesson has at least three steps, a callout and a transcript');

  PERFORM pg_temp.expect(
    NOT EXISTS (SELECT 1 FROM demo_lessons
                 WHERE (SELECT count(*) FROM regexp_matches(body_md, '\[\[', 'g'))
                    <> (SELECT count(*) FROM regexp_matches(body_md, '\[\[[^\]|]+\|[^\]]+\]\]', 'g'))),
    'every glossary term is well formed: [[term|definition]]');

  PERFORM pg_temp.expect(
    (SELECT array_agg(title ORDER BY title) FROM demo_lessons WHERE experience IS NOT NULL) = ARRAY['Leverage and margin']
    AND (SELECT experience FROM demo_lessons WHERE title = 'Leverage and margin') = 'leverage_simulator',
    'only Leverage and margin carries the simulator');

  PERFORM pg_temp.expect(
    (SELECT array_agg(need.title || ' <- ' || has.title ORDER BY need.title, has.title)
       FROM platform.lesson_prerequisites p
       JOIN demo_lessons need ON need.id = p.lesson_id
       JOIN demo_lessons has ON has.id = p.requires_lesson_id)
    = ARRAY[
      'Assets and instruments <- How markets work',
      'Derivatives basics <- Writing a plan',
      'Leverage and margin <- Risk, plainly',
      'Orders and execution <- How markets work',
      'Portfolio construction <- Writing a plan',
      'Position sizing <- Leverage and margin',
      'Position sizing <- Reading a chart',
      'Reading a chart <- Orders and execution',
      'Risk, plainly <- Assets and instruments',
      'Scams and protection <- Risk, plainly',
      'Writing a plan <- Position sizing'],
    'the prototype''s eleven prerequisite links, exactly');

  PERFORM pg_temp.expect(
    NOT EXISTS (
      WITH RECURSIVE walk(start_id, at_id, path) AS (
        SELECT lesson_id, requires_lesson_id, ARRAY[lesson_id] FROM platform.lesson_prerequisites
        UNION ALL
        SELECT w.start_id, p.requires_lesson_id, w.path || w.at_id
          FROM walk w JOIN platform.lesson_prerequisites p ON p.lesson_id = w.at_id
         WHERE NOT w.at_id = ANY(w.path))
      SELECT 1 FROM walk WHERE at_id = start_id),
    'the prerequisites contain no cycle');

  PERFORM pg_temp.expect(
    NOT EXISTS (SELECT 1 FROM demo_lessons l
                 WHERE (SELECT count(*) FROM platform.questions q WHERE q.lesson_id = l.id AND NOT q.is_placement) <> 5)
    AND (SELECT count(*) FROM platform.questions q JOIN demo_courses c ON c.id = q.course_id WHERE NOT q.is_placement) = 55,
    'five check questions per lesson, fifty-five in all');

  PERFORM pg_temp.expect(
    (SELECT array_agg(n ORDER BY tier) FROM (
       SELECT q.tier, count(*) AS n FROM platform.questions q JOIN demo_courses c ON c.id = q.course_id
        WHERE q.is_placement AND q.lesson_id IS NULL AND q.tier = c.tier GROUP BY q.tier) x)
      = ARRAY[2, 2, 2, 2]::bigint[],
    'eight placement questions, two per tier, each on its tier''s course');

  PERFORM pg_temp.expect(
    NOT EXISTS (
      SELECT 1 FROM platform.questions q JOIN demo_courses c ON c.id = q.course_id
       WHERE jsonb_array_length(q.options) <> 3
          OR (SELECT array_agg(o->>'key' ORDER BY o->>'key') FROM jsonb_array_elements(q.options) o) <> ARRAY['a', 'b', 'c']
          OR q.correct_key NOT IN ('a', 'b', 'c')
          OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(q.rationales) k) <> ARRAY['a', 'b', 'c']
          OR EXISTS (SELECT 1 FROM jsonb_each_text(q.rationales) r WHERE length(trim(r.value)) < 10)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(q.options) o WHERE length(trim(o->>'text')) = 0)),
    'every question has options a, b and c, a valid key, and a rationale for every option');

  PERFORM pg_temp.expect(
    (SELECT count(DISTINCT correct_key) FROM platform.questions q JOIN demo_courses c ON c.id = q.course_id) = 3,
    'correct answers are spread across a, b and c');

  PERFORM pg_temp.expect(
    (SELECT count(*) FROM app.tenant_catalogues tc JOIN demo_courses c ON c.id = tc.course_id WHERE tc.enabled) = 12,
    'every academy offers all four courses');

  PERFORM pg_temp.expect(
    to_regclass('app.tenants_seed_view') IS NULL,
    'the test-only tenants_seed_view is not in the demo database');
END $$;

SELECT 'DEMO SEED CHECKS PASSED' AS result;
