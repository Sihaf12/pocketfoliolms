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

-- Test helper: lets the unprivileged role resolve tenant ids by slug
-- without being able to read tenant rows it does not own.
CREATE OR REPLACE VIEW app.tenants_seed_view AS SELECT id, slug FROM app.tenants;
ALTER VIEW app.tenants_seed_view SET (security_invoker = false);
GRANT SELECT ON app.tenants_seed_view TO app_user;
