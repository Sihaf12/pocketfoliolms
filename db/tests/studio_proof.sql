-- =====================================================================
-- Module 4a proof: the studio and console roles, the review state
-- machine, and the separation rule, as the database enforces them.
--
-- Run as the database owner:  psql academy -f db/tests/studio_proof.sql
-- It switches into app_user, app_studio and app_console with SET ROLE,
-- so every check runs with that role's grants and policies. The whole
-- run is one transaction, rolled back at the end: it leaves nothing.
-- =====================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN RAISE NOTICE 'PASS  %', label;
  ELSE RAISE EXCEPTION 'FAIL  %', label; END IF;
END $$;

-- Does running `sql` raise one of the listed SQLSTATEs? Runs in a
-- subtransaction, so a refused statement leaves nothing behind.
CREATE OR REPLACE FUNCTION pg_temp.refused(sql text, codes text[] DEFAULT ARRAY['42501', '23514']) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = ANY(codes) THEN RETURN true; END IF;
  RAISE;
END $$;

-- Fixed ids, so each section can refer to what an earlier one made.
CREATE TEMP TABLE ids (k text PRIMARY KEY, v uuid);
GRANT SELECT ON ids TO app_user, app_studio, app_console;
INSERT INTO ids SELECT 'northgate', id FROM app.tenants WHERE slug = 'northgate';
INSERT INTO ids SELECT 'sable', id FROM app.tenants WHERE slug = 'sable';
INSERT INTO ids SELECT 'platform_course', id FROM platform.courses WHERE slug = 'how-markets-work';
INSERT INTO ids VALUES ('ann', gen_random_uuid()), ('rob', gen_random_uuid()), ('cat', gen_random_uuid()),
                       ('n_course', gen_random_uuid()), ('n_lesson', gen_random_uuid()), ('s_course', gen_random_uuid()),
                       ('p_course', gen_random_uuid());
CREATE OR REPLACE FUNCTION pg_temp.id(key text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT v FROM ids WHERE k = key $$;

-- =====================================================================
-- 1. The studio writes its own academy's private content, and nothing else
-- =====================================================================
SET LOCAL ROLE app_studio;
DO $$
BEGIN
  PERFORM set_config('app.tenant_id', pg_temp.id('northgate')::text, true);
  INSERT INTO platform.courses (id, slug, title, tier, owner_tenant_id)
  VALUES (pg_temp.id('n_course'), 'proof-northgate-private', 'Proof course', 'learn', pg_temp.id('northgate'));
  INSERT INTO platform.lessons (id, course_id, position, title) VALUES (pg_temp.id('n_lesson'), pg_temp.id('n_course'), 1, 'Proof lesson');
  INSERT INTO platform.questions (course_id, lesson_id, tier, prompt, options, correct_key)
  VALUES (pg_temp.id('n_course'), pg_temp.id('n_lesson'), 'learn', 'Proof?', '[{"key":"a","text":"Yes"}]', 'a');
  PERFORM pg_temp.expect(true, 'an academy studio creates its own private course, lesson and question');

  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$INSERT INTO platform.courses (slug, title, tier, owner_tenant_id) VALUES ('proof-x', 'X', 'learn', %L)$q$, pg_temp.id('sable'))),
    'it cannot create a course owned by another academy');
  PERFORM pg_temp.expect(pg_temp.refused(
    $q$INSERT INTO platform.courses (slug, title, tier, owner_tenant_id) VALUES ('proof-y', 'Y', 'learn', NULL)$q$),
    'it cannot create platform content');

  UPDATE platform.courses SET title = 'Hijacked' WHERE id = pg_temp.id('platform_course');
  PERFORM pg_temp.expect((SELECT title FROM platform.courses WHERE id = pg_temp.id('platform_course')) <> 'Hijacked',
    'an update to a platform course touches no row');
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$INSERT INTO platform.lessons (course_id, position, title) VALUES (%L, 99, 'Planted')$q$, pg_temp.id('platform_course'))),
    'it cannot add a lesson to a platform course');
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$UPDATE platform.courses SET owner_tenant_id = NULL WHERE id = %L$q$, pg_temp.id('n_course'))),
    'it cannot hand its private course to the platform');
END $$;

DO $$
BEGIN
  PERFORM set_config('app.tenant_id', pg_temp.id('sable')::text, true);
  INSERT INTO platform.courses (id, slug, title, tier, owner_tenant_id)
  VALUES (pg_temp.id('s_course'), 'proof-sable-private', 'Sable proof', 'learn', pg_temp.id('sable'));
  UPDATE platform.courses SET title = 'Sable was here' WHERE id = pg_temp.id('n_course');
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$INSERT INTO platform.lessons (course_id, position, title) VALUES (%L, 2, 'Planted')$q$, pg_temp.id('n_course'))),
    'another academy cannot add to it');
  PERFORM set_config('app.tenant_id', pg_temp.id('northgate')::text, true);
  PERFORM pg_temp.expect((SELECT title FROM platform.courses WHERE id = pg_temp.id('n_course')) = 'Proof course',
    'another academy''s update touched nothing');
END $$;
RESET ROLE;

-- =====================================================================
-- 2. The learner role gained nothing
-- =====================================================================
SET LOCAL ROLE app_user;
DO $$
BEGIN
  PERFORM set_config('app.tenant_id', pg_temp.id('northgate')::text, true);
  PERFORM pg_temp.expect(pg_temp.refused(
    $q$INSERT INTO platform.courses (slug, title, tier) VALUES ('proof-z', 'Z', 'learn')$q$, ARRAY['42501']),
    'app_user still cannot write course content');
  PERFORM pg_temp.expect(pg_temp.refused($q$UPDATE platform.content_versions SET snapshot = '{}'$q$, ARRAY['42501']),
    'app_user still cannot write content versions');
  PERFORM pg_temp.expect(pg_temp.refused($q$SELECT count(*) FROM app.studio_invitations$q$, ARRAY['42501'])
    AND pg_temp.refused($q$SELECT count(*) FROM app.domain_changes$q$, ARRAY['42501'])
    AND pg_temp.refused($q$SELECT count(*) FROM platform.staff$q$, ARRAY['42501'])
    AND pg_temp.refused($q$SELECT count(*) FROM platform.audit_log$q$, ARRAY['42501'])
    AND pg_temp.refused($q$SELECT count(*) FROM platform.staff_invitations$q$, ARRAY['42501']),
    'app_user cannot read invitations, domain changes, staff, staff invitations or the platform audit log');
  PERFORM pg_temp.expect(pg_temp.refused($q$SELECT count(*) FROM app.tenants$q$, ARRAY['42501']),
    'app_user still cannot read app.tenants');
END $$;
RESET ROLE;

-- =====================================================================
-- 3. The state machine
-- =====================================================================
SET LOCAL ROLE app_studio;
DO $$
DECLARE v bigint;
BEGIN
  PERFORM set_config('app.tenant_id', pg_temp.id('northgate')::text, true);

  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$INSERT INTO platform.content_versions (entity_type, entity_id, version, review_state, snapshot, owner_tenant_id)
       VALUES ('lesson', %L, 1, 'published', '{}', %L)$q$, pg_temp.id('n_lesson'), pg_temp.id('northgate'))),
    'a version cannot be born published');

  INSERT INTO platform.content_versions (entity_type, entity_id, version, review_state, snapshot, owner_tenant_id, created_by)
  VALUES ('lesson', pg_temp.id('n_lesson'), 1, 'draft', '{"title":"v1"}', pg_temp.id('northgate'), pg_temp.id('ann'))
  RETURNING id INTO v;

  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$INSERT INTO platform.content_versions (entity_type, entity_id, version, review_state, snapshot, owner_tenant_id)
       VALUES ('lesson', %L, 2, 'draft', '{}', %L)$q$, pg_temp.id('n_lesson'), pg_temp.id('northgate')), ARRAY['23505']),
    'one version in flight per lesson');

  UPDATE platform.content_versions SET snapshot = '{"title":"v1, edited"}' WHERE id = v;
  PERFORM pg_temp.expect((SELECT snapshot->>'title' FROM platform.content_versions WHERE id = v) = 'v1, edited',
    'a draft can be edited');

  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$UPDATE platform.content_versions SET review_state = 'published', published_by = %L WHERE id = %L$q$, pg_temp.id('cat'), v)),
    'a draft cannot jump to published');
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$UPDATE platform.content_versions SET review_state = 'in_expert_review' WHERE id = %L$q$, v)),
    'submitting needs the author named');

  UPDATE platform.content_versions SET review_state = 'in_expert_review', submitted_by = pg_temp.id('ann') WHERE id = v;
  PERFORM pg_temp.expect((SELECT submitted_at IS NOT NULL FROM platform.content_versions WHERE id = v),
    'submitting records when');
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$UPDATE platform.content_versions SET snapshot = '{"title":"sneaky"}' WHERE id = %L$q$, v)),
    'a submitted version cannot be edited');
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$UPDATE platform.content_versions SET review_state = 'rejected', rejected_by = %L, rejection_notes = '  ' WHERE id = %L$q$,
    pg_temp.id('rob'), v)),
    'sending back needs notes');
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$UPDATE platform.content_versions SET owner_tenant_id = %L WHERE id = %L$q$, pg_temp.id('sable'), v)),
    'a version cannot change owner');
END $$;
RESET ROLE;

-- =====================================================================
-- 4. The separation rule, and its floor
-- =====================================================================
SET LOCAL ROLE app_studio;
DO $$
-- content_versions.id is a bigserial; find version 1 of the proof lesson.
DECLARE v bigint := (SELECT id FROM platform.content_versions
                      WHERE entity_type = 'lesson' AND entity_id = pg_temp.id('n_lesson') AND version = 1);
BEGIN
  PERFORM set_config('app.tenant_id', pg_temp.id('northgate')::text, true);
  -- Northgate has no settings row: the default is two.
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM app.tenant_settings), 'no settings row means the default');

  -- Ann wrote it and reviewed it. At two that is allowed; the floor still bars her from publishing.
  UPDATE platform.content_versions SET review_state = 'in_compliance_review', reviewed_by = pg_temp.id('ann') WHERE id = v;
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$UPDATE platform.content_versions SET review_state = 'published', published_by = %L WHERE id = %L$q$, pg_temp.id('ann'), v)),
    'the floor: the author cannot publish, even at the default of two');

  -- Raise the setting to three: now a self-reviewed version cannot be published by anyone.
  INSERT INTO app.tenant_settings (tenant_id, review_signoffs) VALUES (pg_temp.id('northgate'), 3);
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$UPDATE platform.content_versions SET review_state = 'published', published_by = %L WHERE id = %L$q$, pg_temp.id('cat'), v)),
    'at three, a version its author reviewed cannot be published');

  -- Back to two: cat may publish what ann wrote and reviewed.
  UPDATE app.tenant_settings SET review_signoffs = 2 WHERE tenant_id = pg_temp.id('northgate');
  UPDATE platform.content_versions SET review_state = 'published', published_by = pg_temp.id('cat') WHERE id = v;
  PERFORM pg_temp.expect((SELECT review_state = 'published' AND published_at IS NOT NULL FROM platform.content_versions WHERE id = v),
    'at two, author and publisher differing is enough');

  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$UPDATE app.tenant_settings SET review_signoffs = 1 WHERE tenant_id = %L$q$, pg_temp.id('northgate')))
    AND pg_temp.refused(format(
    $q$UPDATE app.tenant_settings SET review_signoffs = 4 WHERE tenant_id = %L$q$, pg_temp.id('northgate'))),
    'the setting cannot go below two or above three');

  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$UPDATE platform.content_versions SET review_state = 'in_expert_review' WHERE id = %L$q$, v)),
    'a published version cannot go back into review');
  UPDATE platform.content_versions SET review_state = 'retired' WHERE id = v;
  PERFORM pg_temp.expect((SELECT retired_at IS NOT NULL FROM platform.content_versions WHERE id = v), 'published can retire');

  PERFORM set_config('app.tenant_id', pg_temp.id('sable')::text, true);
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM platform.content_versions WHERE id = v),
    'another academy cannot see this academy''s versions');
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM app.tenant_settings),
    'or its settings');
END $$;
RESET ROLE;

-- =====================================================================
-- 5. Platform content: the console's, and always three people
-- =====================================================================
SET LOCAL ROLE app_console;
DO $$
DECLARE v bigint; n integer;
BEGIN
  PERFORM set_config('app.tenant_id', '', true);
  INSERT INTO platform.courses (id, slug, title, tier) VALUES (pg_temp.id('p_course'), 'proof-platform', 'Platform proof', 'learn');
  INSERT INTO platform.content_versions (entity_type, entity_id, version, review_state, snapshot, created_by)
  VALUES ('course', pg_temp.id('p_course'), 1, 'draft', '{"title":"Platform proof"}', pg_temp.id('ann'))
  RETURNING id INTO v;

  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$UPDATE platform.courses SET title = 'x' WHERE id = %L$q$, pg_temp.id('n_course'))) OR
    (SELECT count(*) FROM platform.courses WHERE id = pg_temp.id('n_course')) = 0,
    'the console cannot see or change an academy''s private course');

  UPDATE platform.content_versions SET review_state = 'in_expert_review', submitted_by = pg_temp.id('ann') WHERE id = v;
  UPDATE platform.content_versions SET review_state = 'in_compliance_review', reviewed_by = pg_temp.id('ann') WHERE id = v;
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$UPDATE platform.content_versions SET review_state = 'published', published_by = %L WHERE id = %L$q$, pg_temp.id('cat'), v)),
    'platform content reviewed by its author cannot be published: three is fixed');
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$UPDATE platform.content_versions SET review_state = 'published', published_by = %L WHERE id = %L$q$, pg_temp.id('ann'), v)),
    'and its author cannot publish it');

  UPDATE platform.content_versions SET review_state = 'rejected', rejected_by = pg_temp.id('cat'), rejection_notes = 'Needs a real reviewer.' WHERE id = v;
  INSERT INTO platform.content_versions (entity_type, entity_id, version, review_state, snapshot, created_by)
  VALUES ('course', pg_temp.id('p_course'), 2, 'draft', '{"title":"Platform proof"}', pg_temp.id('ann')) RETURNING id INTO v;
  UPDATE platform.content_versions SET review_state = 'in_expert_review', submitted_by = pg_temp.id('ann') WHERE id = v;
  UPDATE platform.content_versions SET review_state = 'in_compliance_review', reviewed_by = pg_temp.id('rob') WHERE id = v;
  UPDATE platform.content_versions SET review_state = 'published', published_by = pg_temp.id('cat') WHERE id = v;
  PERFORM pg_temp.expect((SELECT review_state = 'published' FROM platform.content_versions WHERE id = v),
    'three different people publish platform content, after a revision');

  SELECT count(*) INTO n FROM app.tenants;
  PERFORM pg_temp.expect(n >= 3, 'the console sees every academy');
  PERFORM pg_temp.expect((SELECT count(*) FROM app.outbox_events) >= 0, 'and the outbox across them');
  PERFORM pg_temp.expect(
        pg_temp.refused($q$SELECT count(*) FROM app.users$q$, ARRAY['42501'])
    AND pg_temp.refused($q$SELECT count(*) FROM app.quiz_attempts$q$, ARRAY['42501'])
    AND pg_temp.refused($q$SELECT count(*) FROM app.sessions$q$, ARRAY['42501'])
    AND pg_temp.refused($q$SELECT count(*) FROM app.enrolments$q$, ARRAY['42501'])
    AND pg_temp.refused($q$SELECT count(*) FROM app.certificates$q$, ARRAY['42501'])
    AND pg_temp.refused($q$SELECT count(*) FROM app.learning_paths$q$, ARRAY['42501'])
    AND pg_temp.refused($q$SELECT count(*) FROM app.system_audit_log$q$, ARRAY['42501']),
    'the console cannot read learners, attempts, sessions, enrolments, certificates, paths or academy audit');
  PERFORM pg_temp.expect(pg_temp.refused($q$DELETE FROM app.tenants$q$, ARRAY['42501']),
    'the console cannot delete an academy');
END $$;
RESET ROLE;

-- Academies see platform versions only once published.
SET LOCAL ROLE app_user;
DO $$
BEGIN
  PERFORM set_config('app.tenant_id', pg_temp.id('sable')::text, true);
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM platform.content_versions WHERE entity_id = pg_temp.id('p_course')) = 1
    AND (SELECT review_state FROM platform.content_versions WHERE entity_id = pg_temp.id('p_course')) = 'published',
    'an academy sees the published platform version, not its rejected draft');
END $$;
RESET ROLE;

-- =====================================================================
-- 6. Invitations expire within 72 hours; staff owners need TOTP
-- =====================================================================
SET LOCAL ROLE app_studio;
DO $$
BEGIN
  PERFORM set_config('app.tenant_id', pg_temp.id('northgate')::text, true);
  INSERT INTO app.studio_invitations (tenant_id, email, roles, token_hash, invited_by, invited_by_kind)
  VALUES (pg_temp.id('northgate'), 'new.author@example.com', ARRAY['author', 'reviewer'], sha256('proof-invite'::bytea), pg_temp.id('ann'), 'studio');
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$INSERT INTO app.studio_invitations (tenant_id, email, roles, token_hash, invited_by_kind, expires_at)
       VALUES (%L, 'late@example.com', ARRAY['author'], sha256('late'::bytea), 'studio', now() + interval '73 hours')$q$, pg_temp.id('northgate'))),
    'an invitation cannot outlive 72 hours');
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$INSERT INTO app.studio_invitations (tenant_id, email, roles, token_hash, invited_by_kind)
       VALUES (%L, 'learner@example.com', ARRAY['author', 'learner'], sha256('learner'::bytea), 'studio')$q$, pg_temp.id('northgate'))),
    'an invitation grants studio roles only, never learner');
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$INSERT INTO app.studio_invitations (tenant_id, email, roles, token_hash, invited_by_kind)
       VALUES (%L, 'nothing@example.com', ARRAY[]::text[], sha256('nothing'::bytea), 'studio')$q$, pg_temp.id('northgate'))),
    'an invitation grants at least one role');
  PERFORM pg_temp.expect(pg_temp.refused(format(
    $q$UPDATE app.users SET studio_roles = ARRAY['author', 'platform_owner'] WHERE tenant_id = %L$q$, pg_temp.id('northgate'))),
    'a user''s studio roles come from the four studio roles only');

  PERFORM set_config('app.tenant_id', pg_temp.id('sable')::text, true);
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM app.studio_invitations), 'another academy cannot see it');
END $$;
RESET ROLE;

SET LOCAL ROLE app_console;
DO $$
BEGIN
  PERFORM pg_temp.expect(pg_temp.refused(
    $q$INSERT INTO platform.staff (email, display_name, role, password_hash) VALUES ('owner@example.com', 'Owner', 'platform_owner', 'x')$q$),
    'a platform owner cannot exist without TOTP');
  INSERT INTO platform.staff (email, display_name, role, password_hash, totp_secret)
  VALUES ('owner@example.com', 'Owner', 'platform_owner', 'x', 'JBSWY3DPEHPK3PXP');
  PERFORM pg_temp.expect(true, 'with TOTP it can');

  PERFORM pg_temp.expect(pg_temp.refused(
    $q$INSERT INTO platform.staff_invitations (email, role, token_hash, invited_by)
       SELECT 'next@example.com', 'platform_owner', sha256('o'::bytea), id FROM platform.staff WHERE email = 'owner@example.com'$q$),
    'the owner role cannot be invited');
  PERFORM pg_temp.expect(pg_temp.refused(
    $q$INSERT INTO platform.staff_invitations (email, role, token_hash, invited_by, expires_at)
       SELECT 'late@example.com', 'platform_author', sha256('l'::bytea), id, now() + interval '73 hours'
         FROM platform.staff WHERE email = 'owner@example.com'$q$),
    'a staff invitation cannot outlive 72 hours');
  INSERT INTO platform.staff_invitations (email, role, token_hash, invited_by)
  SELECT 'reviewer@example.com', 'platform_reviewer', sha256('r'::bytea), id FROM platform.staff WHERE email = 'owner@example.com';
  PERFORM pg_temp.expect(true, 'a reviewer can be invited');
END $$;
RESET ROLE;

-- =====================================================================
-- 7. The platform audit log is a hash chain, and append-only
-- =====================================================================
SET LOCAL ROLE app_console;
DO $$
DECLARE v record;
BEGIN
  PERFORM platform.audit_append('staff:proof', 'content.published', 'course', pg_temp.id('p_course')::text, '{"version":2}');
  PERFORM platform.audit_append('staff:proof', 'tenant.created', 'tenant', 'proof', '{}');
  SELECT * INTO v FROM platform.audit_verify();
  PERFORM pg_temp.expect(v.ok AND v.checked >= 2, 'the platform audit chain verifies');
  PERFORM pg_temp.expect(pg_temp.refused($q$UPDATE platform.audit_log SET action = 'tampered'$q$, ARRAY['P0001', '42501']),
    'platform audit rows cannot be changed');
END $$;
RESET ROLE;

-- =====================================================================
-- 8. Brands are on the ten-token contract
-- =====================================================================
DO $$
BEGIN
  PERFORM pg_temp.expect(NOT EXISTS (
    SELECT 1 FROM app.tenants
     WHERE brand ? 'mode'
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(brand->'tokens', '{}')) k
                    WHERE k NOT IN ('--brand', '--brand-ink', '--accent', '--accent-ink', '--surface',
                                    '--surface-raised', '--line', '--ink', '--ink-soft', '--radius'))),
    'every academy brand uses only the ten contract tokens, with no mode');
END $$;

ROLLBACK;
SELECT 'STUDIO PROOF PASSED' AS result;
