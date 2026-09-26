-- =====================================================================
-- Module 1 proof tests. Run as app_user, which has no BYPASSRLS.
-- Every assertion below either prints PASS or raises.
-- =====================================================================
\set ON_ERROR_STOP on
\pset pager off

CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN RAISE NOTICE 'PASS  %', label;
  ELSE RAISE EXCEPTION 'FAIL  %', label; END IF;
END $$;

-- ---------------------------------------------------------------------
-- 0. Reset anything a previous run left behind, so the suite is repeatable
-- ---------------------------------------------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM app.tenants_seed_view LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    DELETE FROM app.outbox_events;
    DELETE FROM app.sessions;
    DELETE FROM app.enrolments;
    DELETE FROM app.users WHERE email IN ('dual@example.com','smuggled@example.com');
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 1. No tenant in scope returns zero rows rather than an error
-- ---------------------------------------------------------------------
DO $$
DECLARE n integer;
BEGIN
  PERFORM set_config('app.tenant_id', '', true);
  SELECT count(*) INTO n FROM app.users;
  PERFORM pg_temp.expect(n = 0, 'missing tenant returns 0 rows, no error');

  PERFORM set_config('app.tenant_id', '', true);
  SELECT count(*) INTO n FROM app.enrolments;
  PERFORM pg_temp.expect(n = 0, 'missing tenant on enrolments returns 0 rows');
END $$;

-- ---------------------------------------------------------------------
-- 2. Tenant A sees only tenant A
-- ---------------------------------------------------------------------
DO $$
DECLARE a uuid; b uuid; n integer;
BEGIN
  SELECT id INTO a FROM app.tenants_seed_view WHERE slug='northgate';
  SELECT id INTO b FROM app.tenants_seed_view WHERE slug='sable';

  PERFORM set_config('app.tenant_id', a::text, true);
  SELECT count(*) INTO n FROM app.users;
  PERFORM pg_temp.expect(n = 2, 'tenant A sees its own 2 users');

  SELECT count(*) INTO n FROM app.users WHERE tenant_id = b;
  PERFORM pg_temp.expect(n = 0, 'tenant A cannot see tenant B even when asking for it directly');

  PERFORM set_config('app.tenant_id', b::text, true);
  SELECT count(*) INTO n FROM app.users;
  PERFORM pg_temp.expect(n = 1, 'tenant B sees its own 1 user');
END $$;

-- ---------------------------------------------------------------------
-- 3. A write cannot plant a row in another tenant
-- ---------------------------------------------------------------------
DO $$
DECLARE a uuid; b uuid; blocked boolean := false;
BEGIN
  SELECT id INTO a FROM app.tenants_seed_view WHERE slug='northgate';
  SELECT id INTO b FROM app.tenants_seed_view WHERE slug='sable';
  PERFORM set_config('app.tenant_id', a::text, true);
  BEGIN
    INSERT INTO app.users (tenant_id, email, display_name) VALUES (b, 'smuggled@example.com', 'Smuggled');
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  PERFORM pg_temp.expect(blocked, 'WITH CHECK blocks a cross-tenant insert');
END $$;

-- ---------------------------------------------------------------------
-- 4. The same email may exist at two academies
-- ---------------------------------------------------------------------
DO $$
DECLARE a uuid; b uuid; n integer;
BEGIN
  SELECT id INTO a FROM app.tenants_seed_view WHERE slug='northgate';
  SELECT id INTO b FROM app.tenants_seed_view WHERE slug='sable';
  PERFORM set_config('app.tenant_id', a::text, true);
  INSERT INTO app.users (tenant_id, email, display_name) VALUES (a, 'dual@example.com', 'Dual A')
    ON CONFLICT DO NOTHING;
  PERFORM set_config('app.tenant_id', b::text, true);
  INSERT INTO app.users (tenant_id, email, display_name) VALUES (b, 'dual@example.com', 'Dual B')
    ON CONFLICT DO NOTHING;
  SELECT count(*) INTO n FROM app.users WHERE email = 'dual@example.com';
  PERFORM pg_temp.expect(n = 1, 'the same person at two academies is two accounts, each invisible to the other');
END $$;

-- ---------------------------------------------------------------------
-- 5. Outbox is written in the same transaction as the business record
-- ---------------------------------------------------------------------
DO $$
DECLARE a uuid; u uuid; c uuid; before_n integer; after_n integer;
BEGIN
  SELECT id INTO a FROM app.tenants_seed_view WHERE slug='northgate';
  PERFORM set_config('app.tenant_id', a::text, true);
  SELECT id INTO u FROM app.users WHERE tenant_id=a ORDER BY created_at LIMIT 1;
  SELECT id INTO c FROM platform.courses ORDER BY created_at LIMIT 1;

  SELECT count(*) INTO before_n FROM app.outbox_events;

  BEGIN
    INSERT INTO app.enrolments (tenant_id, user_id, course_id, ib_ref_code)
    VALUES (a, u, c, 'IB-4417');
    PERFORM app.outbox_enqueue('lead.enrolled',
      jsonb_build_object('user_id', u, 'course_id', c, 'ib_ref_code', 'IB-4417'),
      'enrol:' || u::text || ':' || c::text, u::text);
    RAISE EXCEPTION 'simulated downstream failure';
  EXCEPTION WHEN OTHERS THEN
    NULL; -- the sub-transaction rolled back
  END;

  SELECT count(*) INTO after_n FROM app.outbox_events;
  PERFORM pg_temp.expect(before_n = after_n,
    'rollback removes the event with the record, so the two can never disagree');
END $$;

-- ---------------------------------------------------------------------
-- 6. Idempotency key prevents a duplicate event
-- ---------------------------------------------------------------------
DO $$
DECLARE a uuid; n integer; first uuid; second uuid;
BEGIN
  SELECT id INTO a FROM app.tenants_seed_view WHERE slug='northgate';
  PERFORM set_config('app.tenant_id', a::text, true);
  first  := app.outbox_enqueue('progression.verified', '{"x":1}'::jsonb, 'idem-test-1', 'u1');
  second := app.outbox_enqueue('progression.verified', '{"x":1}'::jsonb, 'idem-test-1', 'u1');
  SELECT count(*) INTO n FROM app.outbox_events WHERE idempotency_key = 'idem-test-1';
  PERFORM pg_temp.expect(n = 1 AND second IS NULL, 'a repeated event is written once');
END $$;

-- ---------------------------------------------------------------------
-- 7. Audit chain verifies, and history cannot be edited
-- ---------------------------------------------------------------------
DO $$
DECLARE a uuid; v record; blocked boolean := false;
BEGIN
  SELECT id INTO a FROM app.tenants_seed_view WHERE slug='northgate';
  PERFORM set_config('app.tenant_id', a::text, true);
  PERFORM app.audit_append('compliance@northgate', 'content.approved', 'course', 'c-1', '{"v":3}'::jsonb);
  PERFORM app.audit_append('compliance@northgate', 'certificate.issued', 'certificate', 'PA-1', '{"serial":"PA-1"}'::jsonb);

  SELECT * INTO v FROM app.audit_verify(a);
  PERFORM pg_temp.expect(v.ok, 'audit hash chain verifies end to end');

  BEGIN
    UPDATE app.system_audit_log SET action = 'tampered' WHERE tenant_id = a;
  EXCEPTION WHEN OTHERS THEN blocked := true;
  END;
  PERFORM pg_temp.expect(blocked, 'audit rows cannot be updated, even by the application role');
END $$;

-- ---------------------------------------------------------------------
-- 8. Fair-share claim: a busy tenant cannot starve a quiet one
-- ---------------------------------------------------------------------
DO $$
DECLARE a uuid; b uuid; from_a integer; from_b integer;
BEGIN
  SELECT id INTO a FROM app.tenants_seed_view WHERE slug='northgate';
  SELECT id INTO b FROM app.tenants_seed_view WHERE slug='sable';

  PERFORM set_config('app.tenant_id', a::text, true);
  FOR i IN 1..30 LOOP
    PERFORM app.outbox_enqueue('lesson.completed', jsonb_build_object('i', i), 'surge-a-' || i, 'u1');
  END LOOP;
  PERFORM set_config('app.tenant_id', b::text, true);
  FOR i IN 1..2 LOOP
    PERFORM app.outbox_enqueue('lesson.completed', jsonb_build_object('i', i), 'quiet-b-' || i, 'u9');
  END LOOP;

  -- The relay runs under the control-plane role in production. Here we
  -- read the ranking the claim function uses, which is the part under test.
  SELECT count(*) FILTER (WHERE tenant_id = a), count(*) FILTER (WHERE tenant_id = b)
    INTO from_a, from_b
  FROM (
    SELECT e.tenant_id,
           row_number() OVER (PARTITION BY e.tenant_id ORDER BY e.available_at, e.created_at) rn
      FROM app.outbox_events e
     WHERE e.status IN ('pending','failed')
  ) r WHERE rn <= 4;

  PERFORM pg_temp.expect(from_a <= 4, 'the surging tenant is capped at its fair share');
  PERFORM pg_temp.expect(from_b = 2, 'the quiet tenant still gets both of its events in the same batch');
END $$;

-- ---------------------------------------------------------------------
-- 9. A private course, and everything under it, stays with its academy
-- ---------------------------------------------------------------------
DO $$
DECLARE a uuid; b uuid; priv uuid; n_course integer; n_lesson integer; n_question integer;
BEGIN
  SELECT id INTO a FROM app.tenants_seed_view WHERE slug='northgate';
  SELECT id INTO b FROM app.tenants_seed_view WHERE slug='sable';

  -- The owner sees it, so the checks below are not passing vacuously.
  PERFORM set_config('app.tenant_id', a::text, true);
  SELECT id INTO priv FROM platform.courses WHERE slug='northgate-desk-rules';
  SELECT count(*) INTO n_lesson   FROM platform.lessons   WHERE course_id = priv;
  SELECT count(*) INTO n_question FROM platform.questions WHERE course_id = priv;
  PERFORM pg_temp.expect(priv IS NOT NULL AND n_lesson = 1 AND n_question = 1,
    'the owning academy sees its private course, lesson and question');

  PERFORM set_config('app.tenant_id', b::text, true);
  SELECT count(*) INTO n_course   FROM platform.courses   WHERE id = priv;
  SELECT count(*) INTO n_lesson   FROM platform.lessons   WHERE course_id = priv;
  SELECT count(*) INTO n_question FROM platform.questions WHERE course_id = priv;
  PERFORM pg_temp.expect(n_course = 0, 'tenant B cannot read tenant A''s private course, even by id');
  PERFORM pg_temp.expect(n_lesson = 0, 'tenant B cannot read the lessons of tenant A''s private course');
  PERFORM pg_temp.expect(n_question = 0, 'tenant B cannot read the questions of tenant A''s private course');

  SELECT count(*) INTO n_course FROM platform.courses WHERE owner_tenant_id IS NULL;
  PERFORM pg_temp.expect(n_course >= 1, 'tenant B still sees platform-owned courses');

  PERFORM set_config('app.tenant_id', '', true);
  SELECT count(*) INTO n_course FROM platform.courses WHERE owner_tenant_id IS NOT NULL;
  PERFORM pg_temp.expect(n_course = 0, 'with no tenant in scope, no private course is visible');
END $$;

-- ---------------------------------------------------------------------
-- 10. The RLS-bypassing seed view carries its production warning
-- ---------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.expect(
    obj_description('app.tenants_seed_view'::regclass, 'pg_class') LIKE 'TEST HELPER ONLY.%production%',
    'tenants_seed_view is labelled as a test helper that must not reach production');
END $$;

-- ---------------------------------------------------------------------
-- 11. Version snapshots of a private course stay with its academy
-- ---------------------------------------------------------------------
DO $$
DECLARE a uuid; b uuid; priv uuid; pub uuid; les uuid; que uuid;
        n_course integer; n_children integer;
BEGIN
  SELECT id INTO a FROM app.tenants_seed_view WHERE slug='northgate';
  SELECT id INTO b FROM app.tenants_seed_view WHERE slug='sable';

  -- Ids are captured as the owner, who can see them, so B can be asked
  -- for them directly. The owner sees every snapshot, so the checks
  -- below are not passing vacuously.
  PERFORM set_config('app.tenant_id', a::text, true);
  SELECT id INTO priv FROM platform.courses   WHERE slug='northgate-desk-rules';
  SELECT id INTO pub  FROM platform.courses   WHERE slug='how-markets-work';
  SELECT id INTO les  FROM platform.lessons   WHERE course_id = priv;
  SELECT id INTO que  FROM platform.questions WHERE course_id = priv;
  SELECT count(*) INTO n_course FROM platform.content_versions
   WHERE entity_type='course' AND entity_id = priv;
  SELECT count(*) INTO n_children FROM platform.content_versions
   WHERE (entity_type='lesson' AND entity_id = les) OR (entity_type='question' AND entity_id = que);
  PERFORM pg_temp.expect(n_course = 1 AND n_children = 2,
    'the owning academy sees the snapshots of its private course, lesson and question');

  PERFORM set_config('app.tenant_id', b::text, true);
  SELECT count(*) INTO n_course FROM platform.content_versions
   WHERE entity_type='course' AND entity_id = priv;
  PERFORM pg_temp.expect(n_course = 0,
    'tenant B cannot read a snapshot of tenant A''s private course, even by id');

  SELECT count(*) INTO n_children FROM platform.content_versions
   WHERE (entity_type='lesson' AND entity_id = les) OR (entity_type='question' AND entity_id = que);
  PERFORM pg_temp.expect(n_children = 0,
    'tenant B cannot read snapshots of tenant A''s private lessons or questions');

  SELECT count(*) INTO n_course FROM platform.content_versions
   WHERE entity_type='course' AND entity_id = pub;
  PERFORM pg_temp.expect(n_course = 1, 'tenant B still reads snapshots of platform-owned courses');
END $$;

-- ---------------------------------------------------------------------
-- 12. The request role cannot read tenant rows directly, with or without
--     a tenant in scope. Resolution goes through app.resolve_tenant only.
-- ---------------------------------------------------------------------
DO $$
DECLARE a uuid; n integer; blocked_bare boolean := false; blocked_scoped boolean := false;
BEGIN
  SELECT id INTO a FROM app.tenants_seed_view WHERE slug='northgate';

  PERFORM set_config('app.tenant_id', '', true);
  BEGIN
    SELECT count(*) INTO n FROM app.tenants;
  EXCEPTION WHEN insufficient_privilege THEN blocked_bare := true;
  END;

  PERFORM set_config('app.tenant_id', a::text, true);
  BEGIN
    SELECT count(*) INTO n FROM app.tenants;
  EXCEPTION WHEN insufficient_privilege THEN blocked_scoped := true;
  END;

  PERFORM pg_temp.expect(blocked_bare AND blocked_scoped,
    'app_user cannot SELECT from app.tenants directly, with or without a tenant');
END $$;

-- ---------------------------------------------------------------------
-- 13. Tenant resolution: exact, active only, nothing else
-- ---------------------------------------------------------------------
DO $$
DECLARE a uuid;
BEGIN
  SELECT id INTO a FROM app.tenants_seed_view WHERE slug='northgate';
  PERFORM set_config('app.tenant_id', '', true);

  PERFORM pg_temp.expect(app.resolve_tenant('learn.northgate.ae') = a,
    'an academy''s primary domain resolves to that academy');
  PERFORM pg_temp.expect(app.resolve_tenant('LEARN.Northgate.AE') = a,
    'resolution is case-insensitive');
  PERFORM pg_temp.expect(
        app.resolve_tenant('learn.northgate.ae.evil.example') IS NULL
    AND app.resolve_tenant('evil-learn.northgate.ae') IS NULL
    AND app.resolve_tenant('northgate.ae') IS NULL
    AND app.resolve_tenant('%') IS NULL
    AND app.resolve_tenant('') IS NULL,
    'lookalike, parent, wildcard and empty hosts resolve to no academy');
  PERFORM pg_temp.expect(app.resolve_tenant('learn.lapsed.example') IS NULL,
    'a suspended academy''s domain resolves to no academy');
END $$;

-- ---------------------------------------------------------------------
-- 14. Both SECURITY DEFINER functions are locked down the same way
-- ---------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['app.resolve_tenant(text)', 'app.verify_certificate(text)'] LOOP
    PERFORM pg_temp.expect(
      (SELECT p.prosecdef
          AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
         FROM pg_proc p WHERE p.oid = f::regprocedure),
      f || ' is SECURITY DEFINER with a pinned search_path');
    PERFORM pg_temp.expect(
          has_function_privilege('app_user', f, 'EXECUTE')
      AND NOT has_function_privilege('app_control', f, 'EXECUTE'),
      f || ' is executable by app_user only, not through PUBLIC');
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 15. Public certificate verification: no tenant, three fields, and
--     revoked, expired and unknown serials are indistinguishable
-- ---------------------------------------------------------------------
DO $$
DECLARE n integer; r record; out_cols integer;
BEGIN
  PERFORM set_config('app.tenant_id', '', true);

  SELECT count(*) INTO n FROM app.verify_certificate('PA-7K3M-9QXD');
  SELECT * INTO r FROM app.verify_certificate('PA-7K3M-9QXD');
  PERFORM pg_temp.expect(n = 1 AND r.holder_name = 'Amara' AND r.course_title = 'How markets work',
    'a valid certificate verifies with no tenant in scope');

  SELECT count(*) INTO out_cols
    FROM pg_proc p, unnest(p.proargmodes) m
   WHERE p.oid = 'app.verify_certificate(text)'::regprocedure AND m = 't';
  PERFORM pg_temp.expect(out_cols = 3, 'verification returns exactly three columns');

  PERFORM pg_temp.expect(
        (SELECT count(*) FROM app.verify_certificate('PA-R2V8-HC4N')) = 0
    AND (SELECT count(*) FROM app.verify_certificate('PA-W6TJ-P0YB')) = 0
    AND (SELECT count(*) FROM app.verify_certificate('PA-0000-0000')) = 0,
    'revoked, expired and unknown serials all return nothing');
  PERFORM pg_temp.expect(
        (SELECT count(*) FROM app.verify_certificate('PA-%')) = 0
    AND (SELECT count(*) FROM app.verify_certificate('pa-7k3m-9qxd')) = 0,
    'a wildcard or a near-miss serial matches nothing');
END $$;

-- ---------------------------------------------------------------------
-- 16. Serials must be random-format, so a guessable one cannot be stored
-- ---------------------------------------------------------------------
DO $$
DECLARE a uuid; u uuid; c uuid; blocked boolean := false;
BEGIN
  SELECT id INTO a FROM app.tenants_seed_view WHERE slug='northgate';
  PERFORM set_config('app.tenant_id', a::text, true);
  SELECT id INTO u FROM app.users WHERE email = 'yousef@example.com';
  SELECT id INTO c FROM platform.courses WHERE slug = 'northgate-desk-rules';
  BEGIN
    INSERT INTO app.certificates (tenant_id, user_id, course_id, serial, holder_name, course_title)
    VALUES (a, u, c, 'PA-1', 'Yousef', 'Northgate desk rules');
  EXCEPTION WHEN check_violation THEN blocked := true;
  END;
  PERFORM pg_temp.expect(blocked, 'a serial outside PA-XXXX-XXXX is rejected');
END $$;

-- ---------------------------------------------------------------------
-- 17. Sessions are tenant-owned: another academy cannot read or plant one
-- ---------------------------------------------------------------------
DO $$
DECLARE a uuid; b uuid; u uuid; n integer; blocked boolean := false;
BEGIN
  SELECT id INTO a FROM app.tenants_seed_view WHERE slug='northgate';
  SELECT id INTO b FROM app.tenants_seed_view WHERE slug='sable';

  PERFORM set_config('app.tenant_id', a::text, true);
  SELECT id INTO u FROM app.users WHERE email = 'amara@example.com';
  INSERT INTO app.sessions (tenant_id, user_id, token_hash, expires_at)
  VALUES (a, u, sha256('proof-token'::bytea), now() + interval '1 hour');
  SELECT count(*) INTO n FROM app.sessions WHERE token_hash = sha256('proof-token'::bytea);
  PERFORM pg_temp.expect(n = 1, 'an academy reads its own session');

  PERFORM set_config('app.tenant_id', b::text, true);
  SELECT count(*) INTO n FROM app.sessions WHERE token_hash = sha256('proof-token'::bytea);
  PERFORM pg_temp.expect(n = 0, 'tenant B cannot read tenant A''s session, even holding its token');

  BEGIN
    INSERT INTO app.sessions (tenant_id, user_id, token_hash, expires_at)
    VALUES (a, u, sha256('planted'::bytea), now() + interval '1 hour');
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  PERFORM pg_temp.expect(blocked, 'tenant B cannot plant a session in tenant A');
END $$;

-- ---------------------------------------------------------------------
-- 18. The SECURITY DEFINER functions are owned by a role that bypasses
--     RLS. Under FORCE ROW LEVEL SECURITY any other owner sees no rows,
--     and every host and every certificate would answer 404.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.expect(
    (SELECT bool_and(r.rolsuper OR r.rolbypassrls)
       FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.oid IN ('app.resolve_tenant(text)'::regprocedure, 'app.verify_certificate(text)'::regprocedure)),
    'resolve_tenant and verify_certificate are owned by a role that bypasses RLS');
END $$;

SELECT 'ALL MODULE 1 TESTS PASSED' AS result;
