-- Seed run by the control plane (superuser here) before the proof tests.
INSERT INTO platform.courses (slug,title,tier,summary,est_minutes,review_state,published_at)
VALUES ('how-markets-work','How markets work','learn','Foundations',9,'published',now())
ON CONFLICT (slug) DO NOTHING;

INSERT INTO app.tenants (slug,name,primary_domain,brand)
VALUES ('northgate','Northgate Markets','learn.northgate.ae','{"brand":"#1A6DC2"}'),
       ('sable','Sable Wealth','training.sablewealth.io','{"brand":"#6B3F7A"}')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO app.users (tenant_id,email,display_name)
SELECT id,'amara@example.com','Amara' FROM app.tenants WHERE slug='northgate'
ON CONFLICT DO NOTHING;
INSERT INTO app.users (tenant_id,email,display_name)
SELECT id,'yousef@example.com','Yousef' FROM app.tenants WHERE slug='northgate'
ON CONFLICT DO NOTHING;
INSERT INTO app.users (tenant_id,email,display_name)
SELECT id,'lena@example.com','Lena' FROM app.tenants WHERE slug='sable'
ON CONFLICT DO NOTHING;

-- A course private to northgate, with one lesson and one question, so the
-- proof can show sable cannot read any of it.
INSERT INTO platform.courses (slug,title,tier,summary,est_minutes,review_state,published_at,owner_tenant_id)
SELECT 'northgate-desk-rules','Northgate desk rules','learn','Private to Northgate',5,'published',now(), id
  FROM app.tenants WHERE slug='northgate'
ON CONFLICT (slug) DO NOTHING;
INSERT INTO platform.lessons (course_id,position,title)
SELECT id, 1, 'Northgate order handling' FROM platform.courses WHERE slug='northgate-desk-rules'
ON CONFLICT DO NOTHING;
INSERT INTO platform.questions (course_id,tier,prompt,options,correct_key)
SELECT c.id, 'learn', 'Northgate private question', '[{"key":"a","text":"A"}]'::jsonb, 'a'
  FROM platform.courses c
 WHERE c.slug='northgate-desk-rules'
   AND NOT EXISTS (SELECT 1 FROM platform.questions q WHERE q.course_id = c.id);

-- Version snapshots of the private course and everything under it, plus
-- one of the platform course, so the proof can show which ones sable reads.
INSERT INTO platform.content_versions (entity_type,entity_id,version,review_state,snapshot)
SELECT 'course', id, 1, 'published'::platform.review_state, jsonb_build_object('title', title) FROM platform.courses
 WHERE slug IN ('northgate-desk-rules','how-markets-work')
UNION ALL
SELECT 'lesson', l.id, 1, 'published'::platform.review_state, jsonb_build_object('title', l.title)
  FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id WHERE c.slug='northgate-desk-rules'
UNION ALL
SELECT 'question', q.id, 1, 'published'::platform.review_state, jsonb_build_object('prompt', q.prompt)
  FROM platform.questions q JOIN platform.courses c ON c.id = q.course_id WHERE c.slug='northgate-desk-rules'
ON CONFLICT (entity_type, entity_id, version) DO NOTHING;

-- TEST HELPER ONLY. MUST NOT BE APPLIED IN PRODUCTION.
-- Lets the unprivileged role resolve tenant ids by slug without being able
-- to read tenant rows it does not own. It runs with its owner's rights, so
-- it bypasses RLS and lists every tenant's id and slug to app_user. In a
-- live database that tells any academy who the other academies are.
CREATE OR REPLACE VIEW app.tenants_seed_view AS SELECT id, slug FROM app.tenants;
COMMENT ON VIEW app.tenants_seed_view IS
  'TEST HELPER ONLY. Must not be applied in production: bypasses RLS and lists every tenant to app_user.';
ALTER VIEW app.tenants_seed_view SET (security_invoker = false);
GRANT SELECT ON app.tenants_seed_view TO app_user;
