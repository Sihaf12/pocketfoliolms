-- Seed run by the control plane (superuser here) before the proof tests.
INSERT INTO platform.courses (slug,title,tier,summary,est_minutes,review_state,published_at)
VALUES ('how-markets-work','How markets work','learn','Foundations',9,'published',now())
ON CONFLICT (slug) DO NOTHING;

INSERT INTO app.tenants (slug,name,primary_domain,brand)
VALUES ('northgate','Northgate Markets','learn.northgate.ae',
        '{"sub":"Northgate test academy","tokens":{"--brand":"#1A6DC2","--accent":"#F5C400"}}'),
       ('sable','Sable Wealth','training.sablewealth.io',
        '{"sub":"Sable test academy","tokens":{"--brand":"#6B3F7A","--radius":"10px"}}')
ON CONFLICT (slug) DO UPDATE SET brand = EXCLUDED.brand;

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

-- The placement bank: two questions per tier on the platform course, each
-- answered by key 'a', so a test can aim for an exact baseline.
INSERT INTO platform.questions (course_id,tier,is_placement,prompt,options,correct_key)
SELECT c.id, v.tier::platform.tier, true, v.prompt,
       '[{"key":"a","text":"Right"},{"key":"b","text":"Wrong"}]'::jsonb, 'a'
  FROM platform.courses c,
       (VALUES ('learn','Placement learn 1'), ('learn','Placement learn 2'),
               ('safeguard','Placement safeguard 1'), ('safeguard','Placement safeguard 2'),
               ('apply','Placement apply 1'), ('apply','Placement apply 2'),
               ('specialise','Placement specialise 1'), ('specialise','Placement specialise 2')) AS v(tier, prompt)
 WHERE c.slug = 'how-markets-work'
   AND NOT EXISTS (SELECT 1 FROM platform.questions q WHERE q.prompt = v.prompt);

-- Two more platform courses: one in the Apply tier, to prove gating, and
-- one northgate will switch off, to prove the catalogue is respected.
INSERT INTO platform.courses (slug,title,tier,summary,est_minutes,review_state,published_at)
VALUES ('reading-the-tape','Reading the tape','apply','Order flow in practice',12,'published',now()),
       ('risk-basics','Risk basics','safeguard','Position sizing and stops',8,'published',now())
ON CONFLICT (slug) DO NOTHING;

INSERT INTO platform.lessons (course_id,position,title,body_md)
SELECT c.id, v.position, v.title, v.body
  FROM (VALUES ('how-markets-work', 1, 'What a market is', 'Buyers, sellers and a price between them.'),
               ('how-markets-work', 2, 'Orders and fills', 'Market orders take liquidity; limit orders make it.'),
               ('reading-the-tape', 1, 'The order book',   'Depth on each side of the spread.'),
               ('risk-basics',      1, 'Sizing a position', 'Risk a fixed fraction, not a fixed amount.')) AS v(slug, position, title, body)
  JOIN platform.courses c ON c.slug = v.slug
ON CONFLICT DO NOTHING;

-- Knowledge-check questions, each answered by key 'a'. The first lesson
-- has four, so a three-question paper is a real draw.
INSERT INTO platform.questions (course_id,lesson_id,tier,prompt,options,correct_key,rationales)
SELECT l.course_id, l.id, c.tier, v.prompt,
       '[{"key":"a","text":"Right"},{"key":"b","text":"Wrong"}]'::jsonb, 'a',
       '{"a":"That is the definition.","b":"That confuses the two sides."}'::jsonb
  FROM (VALUES ('how-markets-work', 1, 'Check market 1'), ('how-markets-work', 1, 'Check market 2'),
               ('how-markets-work', 1, 'Check market 3'), ('how-markets-work', 1, 'Check market 4'),
               ('how-markets-work', 2, 'Check orders 1'), ('how-markets-work', 2, 'Check orders 2'),
               ('how-markets-work', 2, 'Check orders 3'),
               ('reading-the-tape', 1, 'Check tape 1'),   ('reading-the-tape', 1, 'Check tape 2'),
               ('reading-the-tape', 1, 'Check tape 3')) AS v(slug, position, prompt)
  JOIN platform.courses c ON c.slug = v.slug
  JOIN platform.lessons l ON l.course_id = c.id AND l.position = v.position
 WHERE NOT EXISTS (SELECT 1 FROM platform.questions q WHERE q.prompt = v.prompt);

-- XP for the lessons the HTTP tests pass, and one cross-course
-- prerequisite: Reading the tape needs Orders and fills.
UPDATE platform.lessons l SET xp = v.xp
  FROM (VALUES ('how-markets-work', 1, 100), ('how-markets-work', 2, 150), ('reading-the-tape', 1, 200)) AS v(slug, position, xp),
       platform.courses c
 WHERE c.slug = v.slug AND l.course_id = c.id AND l.position = v.position;

INSERT INTO platform.lesson_prerequisites (lesson_id, requires_lesson_id)
SELECT need.id, has.id
  FROM platform.lessons need JOIN platform.courses nc ON nc.id = need.course_id,
       platform.lessons has  JOIN platform.courses hc ON hc.id = has.course_id
 WHERE (nc.slug, need.position, hc.slug, has.position) IN
       (('reading-the-tape', 1, 'how-markets-work', 2),
        ('northgate-desk-rules', 1, 'how-markets-work', 1))
ON CONFLICT DO NOTHING;

-- Catalogues. Northgate offers everything but has switched Risk basics
-- off. Sable's catalogue even names northgate's private course, which
-- RLS on platform.courses must still hide from sable.
INSERT INTO app.tenant_catalogues (tenant_id,course_id,enabled,position)
SELECT t.id, c.id, v.enabled, v.position
  FROM (VALUES ('northgate','how-markets-work',     true,  1),
               ('northgate','northgate-desk-rules', true,  2),
               ('northgate','reading-the-tape',     true,  3),
               ('northgate','risk-basics',          false, 4),
               ('sable',    'how-markets-work',     true,  1),
               ('sable',    'northgate-desk-rules', true,  2)) AS v(slug, course, enabled, position)
  JOIN app.tenants t ON t.slug = v.slug
  JOIN platform.courses c ON c.slug = v.course
ON CONFLICT (tenant_id, course_id) DO NOTHING;

-- Version snapshots of the private course and everything under it, plus
-- one of the platform course, so the proof can show which ones sable reads.
INSERT INTO platform.content_versions (entity_type,entity_id,version,review_state,snapshot,owner_tenant_id)
SELECT 'course', id, 1, 'published'::platform.review_state, jsonb_build_object('title', title), owner_tenant_id FROM platform.courses
 WHERE slug IN ('northgate-desk-rules','how-markets-work')
UNION ALL
SELECT 'lesson', l.id, 1, 'published'::platform.review_state, jsonb_build_object('title', l.title), c.owner_tenant_id
  FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id WHERE c.slug='northgate-desk-rules'
UNION ALL
SELECT 'question', q.id, 1, 'published'::platform.review_state, jsonb_build_object('prompt', q.prompt), c.owner_tenant_id
  FROM platform.questions q JOIN platform.courses c ON c.id = q.course_id WHERE c.slug='northgate-desk-rules'
ON CONFLICT (entity_type, entity_id, version) DO NOTHING;

-- A suspended academy, so the proofs can show its host resolves to nothing.
INSERT INTO app.tenants (slug,name,primary_domain,status)
VALUES ('lapsed','Lapsed Brokerage','learn.lapsed.example','suspended')
ON CONFLICT (slug) DO NOTHING;

-- One valid, one revoked and one expired certificate, all at northgate.
INSERT INTO app.certificates (tenant_id,user_id,course_id,serial,holder_name,course_title,issued_at,expires_at,revoked_at,revoke_reason)
SELECT u.tenant_id, u.id, c.id, v.serial, u.display_name, c.title, v.issued_at, v.expires_at, v.revoked_at, v.reason
  FROM (VALUES
    ('amara@example.com',  'how-markets-work',     'PA-7K3M-9QXD', timestamptz '2026-03-01', NULL::timestamptz,       NULL::timestamptz,        NULL),
    ('yousef@example.com', 'how-markets-work',     'PA-R2V8-HC4N', timestamptz '2026-03-01', NULL,                    timestamptz '2026-04-01', 'issued in error'),
    ('amara@example.com',  'northgate-desk-rules', 'PA-W6TJ-P0YB', timestamptz '2025-01-01', timestamptz '2025-12-31', NULL,                   NULL)
  ) AS v(email, slug, serial, issued_at, expires_at, revoked_at, reason)
  JOIN app.users u ON u.email = v.email
  JOIN app.tenants t ON t.id = u.tenant_id AND t.slug = 'northgate'
  JOIN platform.courses c ON c.slug = v.slug
ON CONFLICT DO NOTHING;

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
