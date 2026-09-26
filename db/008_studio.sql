-- =====================================================================
-- Trader Academy Platform  ·  Module 4a  ·  The content studio
--
-- Roles
--   app_user     learners. Unchanged: read-only on platform content.
--   app_studio   the academy studio. Writes its own academy's private
--                content and settings, under the same tenant RLS.
--   app_console  the platform console. Platform-owned content, the list
--                of academies, and the outbox across them. Nothing about
--                learners: no users, attempts, sessions or enrolments.
--
-- Content workflow
--   A draft is a snapshot in platform.content_versions. The live rows in
--   platform.courses, lessons and questions are what learners read, and
--   only a publish writes them. A trigger holds the state machine, so no
--   code path can skip a step, and holds the separation rule: author and
--   publisher are always different people; an academy may require the
--   reviewer to be a third person, and platform content always does.
--
-- Also here: platform staff and their sessions, a hash-chained platform
-- audit log, academy settings, studio invitations, domain changes, and
-- the move to the academy-design skill's ten-token brand contract.
--
-- Idempotent, like every migration here: npm run migrate re-runs it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Roles.
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE ROLE app_studio LOGIN PASSWORD 'change_me_in_deployment';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE ROLE app_console LOGIN PASSWORD 'change_me_in_deployment';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TYPE app.user_role IS
  'Roles within one academy. platform_owner is deprecated: platform staff live in platform.staff and sign in on the console host.';

-- ---------------------------------------------------------------------
-- Academy settings. One row per academy; a missing row means defaults.
-- review_signoffs is how many different people a version needs:
--   2  the author and the publisher differ (the floor)
--   3  author, reviewer and publisher all differ
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.tenant_settings (
  tenant_id       uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  review_signoffs smallint NOT NULL DEFAULT 2 CHECK (review_signoffs BETWEEN 2 AND 3),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Studio invitations: single use, shown once, valid for at most 72 hours.
-- Only a hash of the token is stored.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.studio_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  email        text NOT NULL CHECK (email = lower(email)),
  role         app.user_role NOT NULL CHECK (role IN ('author', 'reviewer', 'compliance', 'tenant_admin')),
  token_hash   bytea NOT NULL UNIQUE,
  invited_by   uuid NULL,                     -- a studio user, or platform staff for an academy's first admin
  invited_by_kind text NOT NULL CHECK (invited_by_kind IN ('studio', 'platform')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '72 hours',
  accepted_at  timestamptz NULL,
  revoked_at   timestamptz NULL,
  CONSTRAINT ck_invitation_lifetime CHECK (expires_at > created_at AND expires_at <= created_at + interval '72 hours')
);
CREATE INDEX IF NOT EXISTS ix_invitations_tenant ON app.studio_invitations (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Domain changes take effect only after a DNS TXT check, or a platform
-- owner override. One pending request per academy.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.domain_changes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  requested_domain text NOT NULL CHECK (requested_domain = lower(requested_domain)),
  txt_token        text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'overridden', 'cancelled')),
  requested_by     uuid NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  resolved_by      uuid NULL,
  resolved_at      timestamptz NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_domain_change_pending ON app.domain_changes (tenant_id) WHERE status = 'pending';

-- Studio sessions live beside learner sessions and are never mistaken for them.
ALTER TABLE app.sessions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'learner';
DO $$ BEGIN
  ALTER TABLE app.sessions ADD CONSTRAINT ck_sessions_kind CHECK (kind IN ('learner', 'studio'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The three new tenant tables: RLS enabled and forced, isolated by tenant.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_settings', 'studio_invitations', 'domain_changes'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON app.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON app.%I
        USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant())
    $f$, t);
    EXECUTE format('DROP POLICY IF EXISTS control_plane ON app.%I', t);
    EXECUTE format('CREATE POLICY control_plane ON app.%I TO app_control USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Platform staff: the console's own identity, outside every academy.
-- The owner must have TOTP enrolled; the secret is set when the account
-- is provisioned.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.staff (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name  text NOT NULL,
  role          text NOT NULL CHECK (role IN ('platform_owner', 'platform_author', 'platform_reviewer', 'platform_compliance')),
  password_hash text NOT NULL,
  totp_secret   text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  disabled_at   timestamptz NULL,
  CONSTRAINT ck_owner_has_totp CHECK (role <> 'platform_owner' OR totp_secret IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS platform.staff_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     uuid NOT NULL REFERENCES platform.staff(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  mfa_verified_at timestamptz NULL,
  revoked_at   timestamptz NULL
);

-- ---------------------------------------------------------------------
-- Platform audit log: the same hash chain as app.system_audit_log, for
-- changes that belong to no academy.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.audit_log (
  id          bigserial PRIMARY KEY,
  seq         bigint NOT NULL UNIQUE,
  actor       text NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash   text NOT NULL,
  hash        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION platform.audit_append(
  p_actor text, p_action text, p_entity_type text, p_entity_id text, p_payload jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_seq bigint; v_prev text; v_hash text; v_id bigint;
BEGIN
  -- One writer at a time, so two appends cannot take the same seq.
  PERFORM pg_advisory_xact_lock(hashtext('platform.audit_log'));
  SELECT COALESCE(MAX(seq), 0) + 1,
         COALESCE((SELECT hash FROM platform.audit_log ORDER BY seq DESC LIMIT 1), repeat('0', 64))
    INTO v_seq, v_prev
    FROM platform.audit_log;
  v_hash := encode(digest(
      v_prev || '|' || v_seq::text || '|' || p_actor || '|' || p_action || '|' ||
      p_entity_type || '|' || COALESCE(p_entity_id, '') || '|' || p_payload::text, 'sha256'), 'hex');
  INSERT INTO platform.audit_log (seq, actor, action, entity_type, entity_id, payload, prev_hash, hash)
  VALUES (v_seq, p_actor, p_action, p_entity_type, p_entity_id, p_payload, v_prev, v_hash)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION platform.audit_verify()
RETURNS TABLE (ok boolean, broken_at bigint, checked bigint)
LANGUAGE plpgsql STABLE AS $$
DECLARE r record; v_prev text := repeat('0', 64); v_calc text; v_n bigint := 0;
BEGIN
  FOR r IN SELECT * FROM platform.audit_log ORDER BY seq LOOP
    v_calc := encode(digest(
        v_prev || '|' || r.seq::text || '|' || r.actor || '|' || r.action || '|' ||
        r.entity_type || '|' || COALESCE(r.entity_id, '') || '|' || r.payload::text, 'sha256'), 'hex');
    v_n := v_n + 1;
    IF v_calc <> r.hash OR r.prev_hash <> v_prev THEN
      RETURN QUERY SELECT false, r.seq, v_n; RETURN;
    END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN QUERY SELECT true, NULL::bigint, v_n;
END $$;

DROP TRIGGER IF EXISTS trg_platform_audit_immutable ON platform.audit_log;
CREATE TRIGGER trg_platform_audit_immutable
  BEFORE UPDATE OR DELETE ON platform.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_immutable();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff', 'staff_sessions', 'audit_log'] LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS console_access ON platform.%I', t);
    EXECUTE format('CREATE POLICY console_access ON platform.%I TO app_console USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Content versions: who owns them, who acted, and why a version was
-- sent back. owner_tenant_id is NULL for platform content.
-- ---------------------------------------------------------------------
ALTER TABLE platform.content_versions
  ADD COLUMN IF NOT EXISTS owner_tenant_id uuid NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by      uuid NULL,
  ADD COLUMN IF NOT EXISTS submitted_by    uuid NULL,
  ADD COLUMN IF NOT EXISTS submitted_at    timestamptz NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by     uuid NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS published_by    uuid NULL,
  ADD COLUMN IF NOT EXISTS published_at    timestamptz NULL,
  ADD COLUMN IF NOT EXISTS rejected_by     uuid NULL,
  ADD COLUMN IF NOT EXISTS rejected_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS rejection_notes text NULL,
  ADD COLUMN IF NOT EXISTS retired_at      timestamptz NULL,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN platform.content_versions.approved_by IS 'Deprecated. See submitted_by, reviewed_by and published_by.';
COMMENT ON COLUMN platform.content_versions.approved_at IS 'Deprecated. See reviewed_at and published_at.';

-- Versions written before this migration take their owner from the
-- course they trace back to.
UPDATE platform.content_versions v
   SET owner_tenant_id = c.owner_tenant_id
  FROM platform.courses c
 WHERE v.owner_tenant_id IS NULL
   AND c.owner_tenant_id IS NOT NULL
   AND c.id = CASE v.entity_type
                WHEN 'course'   THEN v.entity_id
                WHEN 'lesson'   THEN (SELECT l.course_id FROM platform.lessons l WHERE l.id = v.entity_id)
                WHEN 'question' THEN (SELECT q.course_id FROM platform.questions q WHERE q.id = v.entity_id)
              END;

-- One version in flight per entity: a second draft cannot open while one
-- is being written or reviewed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_versions_in_flight
  ON platform.content_versions (entity_type, entity_id)
  WHERE review_state IN ('draft', 'in_expert_review', 'in_compliance_review');

-- ---------------------------------------------------------------------
-- The review state machine, enforced for every role.
--
--   draft               -> in_expert_review      submit   (submitted_by)
--   in_expert_review    -> in_compliance_review  approve  (reviewed_by)
--   in_expert_review    -> rejected              reject   (rejected_by, notes)
--   in_compliance_review-> rejected              reject   (rejected_by, notes)
--   in_compliance_review-> published             publish  (published_by, separation)
--   published           -> retired               retire, or superseded by a newer publish
--
-- A rejected version stays rejected; revising it opens a new draft.
-- 'approved' is unused: compliance publishes directly.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.content_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE required smallint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The request-path roles may only start a version as a draft.
    IF current_user IN ('app_studio', 'app_console') AND NEW.review_state <> 'draft' THEN
      RAISE EXCEPTION 'a new version must start as a draft, not %', NEW.review_state
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.entity_type <> OLD.entity_type OR NEW.entity_id <> OLD.entity_id OR NEW.version <> OLD.version
     OR NEW.owner_tenant_id IS DISTINCT FROM OLD.owner_tenant_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'a version''s identity and owner cannot change' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot AND NOT (OLD.review_state = 'draft' AND NEW.review_state = 'draft') THEN
    RAISE EXCEPTION 'only a draft can be edited; this version is %', OLD.review_state USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  IF NEW.review_state = OLD.review_state THEN RETURN NEW; END IF;

  IF (OLD.review_state, NEW.review_state) NOT IN (
       ('draft', 'in_expert_review'),
       ('in_expert_review', 'in_compliance_review'),
       ('in_expert_review', 'rejected'),
       ('in_compliance_review', 'rejected'),
       ('in_compliance_review', 'published'),
       ('published', 'retired')) THEN
    RAISE EXCEPTION 'illegal review transition % -> %', OLD.review_state, NEW.review_state
      USING ERRCODE = 'check_violation';
  END IF;

  CASE NEW.review_state
    WHEN 'in_expert_review' THEN
      IF NEW.submitted_by IS NULL THEN RAISE EXCEPTION 'submitting needs submitted_by' USING ERRCODE = 'check_violation'; END IF;
      NEW.submitted_at := now();
    WHEN 'in_compliance_review' THEN
      IF NEW.reviewed_by IS NULL THEN RAISE EXCEPTION 'approving needs reviewed_by' USING ERRCODE = 'check_violation'; END IF;
      NEW.reviewed_at := now();
    WHEN 'rejected' THEN
      IF NEW.rejected_by IS NULL OR length(trim(COALESCE(NEW.rejection_notes, ''))) = 0 THEN
        RAISE EXCEPTION 'sending a version back needs notes' USING ERRCODE = 'check_violation';
      END IF;
      NEW.rejected_at := now();
    WHEN 'published' THEN
      IF NEW.published_by IS NULL THEN RAISE EXCEPTION 'publishing needs published_by' USING ERRCODE = 'check_violation'; END IF;
      -- The floor, for everyone: the author never publishes their own work.
      IF NEW.published_by = NEW.submitted_by THEN
        RAISE EXCEPTION 'the author and the publisher must be different people' USING ERRCODE = 'check_violation';
      END IF;
      required := CASE WHEN NEW.owner_tenant_id IS NULL THEN 3
                       ELSE COALESCE((SELECT s.review_signoffs FROM app.tenant_settings s
                                       WHERE s.tenant_id = NEW.owner_tenant_id), 2) END;
      IF required = 3 AND (NEW.reviewed_by = NEW.submitted_by OR NEW.reviewed_by = NEW.published_by) THEN
        RAISE EXCEPTION 'this content needs three different people: author, reviewer and publisher'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.published_at := now();
    WHEN 'retired' THEN
      NEW.retired_at := now();
    ELSE NULL;
  END CASE;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_content_version_guard ON platform.content_versions;
CREATE TRIGGER trg_content_version_guard
  BEFORE INSERT OR UPDATE ON platform.content_versions
  FOR EACH ROW EXECUTE FUNCTION platform.content_version_guard();

-- Visibility: an academy sees its own versions at any state; everyone
-- sees published and retired versions of platform-owned content. This
-- replaces 004's rule, which traced through the live rows and so showed
-- every academy the drafts of platform content, and could not see a
-- draft whose live row did not exist yet.
DROP POLICY IF EXISTS tenant_visibility ON platform.content_versions;
CREATE POLICY tenant_visibility ON platform.content_versions
  FOR SELECT
  USING (owner_tenant_id = app.current_tenant()
         OR (owner_tenant_id IS NULL AND review_state IN ('published', 'retired')));

-- ---------------------------------------------------------------------
-- app_studio: an academy's studio. Everything app_user may do in its
-- academy, plus writing its own private content and settings.
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA app, platform TO app_studio;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_studio;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_studio;
REVOKE ALL ON app.tenants FROM app_studio;
GRANT SELECT ON ALL TABLES IN SCHEMA platform TO app_studio;
REVOKE ALL ON platform.staff, platform.staff_sessions, platform.audit_log FROM app_studio;
GRANT INSERT, UPDATE ON platform.courses, platform.lessons, platform.content_versions TO app_studio;
GRANT INSERT, UPDATE, DELETE ON platform.questions, platform.lesson_prerequisites TO app_studio;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO app_studio;
GRANT EXECUTE ON FUNCTION app.current_tenant_brand() TO app_studio;

-- app_user keeps what 002 and 005 gave it, and nothing new: the default
-- privileges from 002 would otherwise hand it these tables.
REVOKE ALL ON app.studio_invitations, app.domain_changes FROM app_user;
REVOKE INSERT, UPDATE, DELETE ON app.tenant_settings FROM app_user;
REVOKE ALL ON platform.staff, platform.staff_sessions, platform.audit_log FROM app_user;

-- Studio writes: only content whose course this academy owns.
DROP POLICY IF EXISTS studio_insert ON platform.courses;
CREATE POLICY studio_insert ON platform.courses FOR INSERT TO app_studio
  WITH CHECK (owner_tenant_id = app.current_tenant());
DROP POLICY IF EXISTS studio_update ON platform.courses;
CREATE POLICY studio_update ON platform.courses FOR UPDATE TO app_studio
  USING (owner_tenant_id = app.current_tenant()) WITH CHECK (owner_tenant_id = app.current_tenant());

DO $$
DECLARE t text; cmd text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lessons', 'questions'] LOOP
    FOREACH cmd IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      CONTINUE WHEN t = 'lessons' AND cmd = 'DELETE';
      EXECUTE format('DROP POLICY IF EXISTS studio_%s ON platform.%I', lower(cmd), t);
      EXECUTE format($f$
        CREATE POLICY studio_%1$s ON platform.%2$I FOR %3$s TO app_studio
          %4$s
      $f$, lower(cmd), t, cmd,
        CASE cmd
          WHEN 'INSERT' THEN format('WITH CHECK (EXISTS (SELECT 1 FROM platform.courses c WHERE c.id = %I.course_id AND c.owner_tenant_id = app.current_tenant()))', t)
          WHEN 'UPDATE' THEN format('USING (EXISTS (SELECT 1 FROM platform.courses c WHERE c.id = %1$I.course_id AND c.owner_tenant_id = app.current_tenant())) WITH CHECK (EXISTS (SELECT 1 FROM platform.courses c WHERE c.id = %1$I.course_id AND c.owner_tenant_id = app.current_tenant()))', t)
          ELSE format('USING (EXISTS (SELECT 1 FROM platform.courses c WHERE c.id = %I.course_id AND c.owner_tenant_id = app.current_tenant()))', t)
        END);
    END LOOP;
  END LOOP;
END $$;

DROP POLICY IF EXISTS studio_insert ON platform.lesson_prerequisites;
CREATE POLICY studio_insert ON platform.lesson_prerequisites FOR INSERT TO app_studio
  WITH CHECK (EXISTS (SELECT 1 FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id
                       WHERE l.id = lesson_prerequisites.lesson_id AND c.owner_tenant_id = app.current_tenant()));
DROP POLICY IF EXISTS studio_delete ON platform.lesson_prerequisites;
CREATE POLICY studio_delete ON platform.lesson_prerequisites FOR DELETE TO app_studio
  USING (EXISTS (SELECT 1 FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id
                  WHERE l.id = lesson_prerequisites.lesson_id AND c.owner_tenant_id = app.current_tenant()));

DROP POLICY IF EXISTS studio_insert ON platform.content_versions;
CREATE POLICY studio_insert ON platform.content_versions FOR INSERT TO app_studio
  WITH CHECK (owner_tenant_id = app.current_tenant());
DROP POLICY IF EXISTS studio_update ON platform.content_versions;
CREATE POLICY studio_update ON platform.content_versions FOR UPDATE TO app_studio
  USING (owner_tenant_id = app.current_tenant()) WITH CHECK (owner_tenant_id = app.current_tenant());

-- ---------------------------------------------------------------------
-- app_console: platform content, academies, and the outbox. Its grants
-- name every table it may touch; it has none on learner data.
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA app, platform TO app_console;
GRANT SELECT, INSERT, UPDATE ON app.tenants TO app_console;
GRANT SELECT, UPDATE ON app.outbox_events TO app_console;
GRANT SELECT, INSERT ON app.tenant_catalogues, app.tenant_settings TO app_console;
GRANT SELECT, INSERT, UPDATE ON app.studio_invitations TO app_console;
GRANT SELECT, UPDATE ON app.domain_changes TO app_console;
GRANT SELECT ON ALL TABLES IN SCHEMA platform TO app_console;
GRANT INSERT, UPDATE ON platform.courses, platform.lessons, platform.content_versions, platform.glossary_terms TO app_console;
GRANT INSERT, UPDATE, DELETE ON platform.questions, platform.lesson_prerequisites TO app_console;
GRANT SELECT, INSERT, UPDATE ON platform.staff, platform.staff_sessions TO app_console;
GRANT SELECT, INSERT ON platform.audit_log TO app_console;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO app_console;
GRANT EXECUTE ON FUNCTION platform.audit_append(text, text, text, text, jsonb), platform.audit_verify() TO app_console;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants', 'outbox_events', 'tenant_catalogues', 'tenant_settings', 'studio_invitations', 'domain_changes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS console_access ON app.%I', t);
    EXECUTE format('CREATE POLICY console_access ON app.%I TO app_console USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Platform content only: an academy's private course is not the console's.
DROP POLICY IF EXISTS console_write ON platform.courses;
CREATE POLICY console_write ON platform.courses TO app_console
  USING (owner_tenant_id IS NULL) WITH CHECK (owner_tenant_id IS NULL);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lessons', 'questions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS console_write ON platform.%I', t);
    EXECUTE format($f$
      CREATE POLICY console_write ON platform.%1$I TO app_console
        USING (EXISTS (SELECT 1 FROM platform.courses c WHERE c.id = %1$I.course_id AND c.owner_tenant_id IS NULL))
        WITH CHECK (EXISTS (SELECT 1 FROM platform.courses c WHERE c.id = %1$I.course_id AND c.owner_tenant_id IS NULL))
    $f$, t);
  END LOOP;
END $$;
-- Stated positively: RLS hides academy-owned lessons from the console,
-- so "no linked lesson is academy-owned" would pass for exactly the rows
-- it should refuse. Both lessons must be seen to be platform-owned.
DROP POLICY IF EXISTS console_write ON platform.lesson_prerequisites;
CREATE POLICY console_write ON platform.lesson_prerequisites TO app_console
  USING (    EXISTS (SELECT 1 FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id
                      WHERE l.id = lesson_prerequisites.lesson_id AND c.owner_tenant_id IS NULL)
         AND EXISTS (SELECT 1 FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id
                      WHERE l.id = lesson_prerequisites.requires_lesson_id AND c.owner_tenant_id IS NULL))
  WITH CHECK (    EXISTS (SELECT 1 FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id
                           WHERE l.id = lesson_prerequisites.lesson_id AND c.owner_tenant_id IS NULL)
              AND EXISTS (SELECT 1 FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id
                           WHERE l.id = lesson_prerequisites.requires_lesson_id AND c.owner_tenant_id IS NULL));
DROP POLICY IF EXISTS console_write ON platform.content_versions;
CREATE POLICY console_write ON platform.content_versions TO app_console
  USING (owner_tenant_id IS NULL) WITH CHECK (owner_tenant_id IS NULL);

-- ---------------------------------------------------------------------
-- Brands move to the academy-design skill's contract: ten tokens an
-- academy may set. Tier and status colours become fixed everywhere, and
-- there is no light or dark mode, only token sets.
--
-- Only a brand still in the old shape is converted: it carries a mode,
-- or a token name only the old shape used. A second run finds nothing.
-- ---------------------------------------------------------------------
UPDATE app.tenants t
   SET brand = jsonb_strip_nulls(jsonb_build_object(
         'sub', t.brand->'sub',
         'tokens', COALESCE((
           SELECT jsonb_object_agg(m.new_name, t.brand->'tokens'->m.old_name)
             FROM (VALUES ('--brand', '--brand'), ('--brandtext', '--brand-ink'), ('--accent', '--accent'),
                          ('--accent-ink', '--accent-ink'), ('--bg', '--surface'), ('--surface', '--surface-raised'),
                          ('--line', '--line'), ('--ink', '--ink'), ('--muted', '--ink-soft'), ('--r', '--radius'))
                  AS m(old_name, new_name)
            WHERE t.brand->'tokens' ? m.old_name), '{}'::jsonb)))
 WHERE t.brand ? 'mode'
    OR (t.brand->'tokens') ?| ARRAY['--brandtext', '--bg', '--muted', '--r', '--r-s', '--r-l', '--brand-d', '--brand-t',
                                    '--surface-2', '--line-2', '--faint', '--ok', '--ok-t', '--warn', '--warn-t',
                                    '--bad', '--bad-t', '--learn', '--safeguard', '--apply', '--specialise'];
