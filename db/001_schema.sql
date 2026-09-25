-- =====================================================================
-- Trader Academy Platform  ·  Module 1a  ·  Core schema
-- PostgreSQL 16+
--
-- Two ownership domains:
--   platform.*  content owned centrally, shared by every academy
--   app.*       tenant-owned records, isolated by row-level security
--
-- Every tenant table carries tenant_id and is protected in 002_rls.sql.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------------
-- Enumerated domains
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE app.lifecycle_state AS ENUM
    ('registered','onboarded','placed','activated','active','certified','dormant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.user_role AS ENUM
    ('learner','author','reviewer','compliance','tenant_admin','platform_owner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE platform.tier AS ENUM ('learn','safeguard','apply','specialise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE platform.review_state AS ENUM
    ('draft','in_expert_review','in_compliance_review','approved','published','rejected','retired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.outbox_status AS ENUM ('pending','in_flight','delivered','failed','dead');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.guardrail_verdict AS ENUM ('allowed','blocked_ingress','blocked_egress','no_grounding');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================================
-- PLATFORM OWNED  ·  no tenant_id, no RLS, readable by every tenant
-- =====================================================================

CREATE TABLE IF NOT EXISTS platform.courses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  title           text NOT NULL,
  tier            platform.tier NOT NULL,
  summary         text NOT NULL DEFAULT '',
  est_minutes     integer NOT NULL DEFAULT 10 CHECK (est_minutes BETWEEN 1 AND 600),
  prerequisites   text[] NOT NULL DEFAULT '{}',
  -- NULL means platform-owned and offered to every academy.
  -- A uuid means the course belongs to that one academy only.
  owner_tenant_id uuid NULL,
  review_state    platform.review_state NOT NULL DEFAULT 'draft',
  published_at    timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_courses_tier      ON platform.courses (tier) WHERE review_state = 'published';
CREATE INDEX IF NOT EXISTS ix_courses_owner     ON platform.courses (owner_tenant_id) WHERE owner_tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform.lessons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid NOT NULL REFERENCES platform.courses(id) ON DELETE CASCADE,
  position      integer NOT NULL CHECK (position > 0),
  title         text NOT NULL,
  body_md       text NOT NULL DEFAULT '',
  video_asset   text NULL,
  transcript    jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_secs integer NOT NULL DEFAULT 0 CHECK (duration_secs >= 0),
  author_name     text NOT NULL DEFAULT '',
  reviewer_name   text NOT NULL DEFAULT '',
  reviewed_at     timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, position)
);

CREATE TABLE IF NOT EXISTS platform.questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid NOT NULL REFERENCES platform.courses(id) ON DELETE CASCADE,
  lesson_id     uuid NULL REFERENCES platform.lessons(id) ON DELETE SET NULL,
  tier          platform.tier NOT NULL,
  -- 1 easiest .. 5 hardest. Calibrated by curriculum, refined from real responses.
  difficulty    smallint NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  is_placement  boolean NOT NULL DEFAULT false,
  prompt        text NOT NULL,
  options       jsonb NOT NULL,           -- [{key,text}]
  correct_key   text NOT NULL,
  -- A rationale for every option, including the wrong ones.
  rationales    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_questions_options CHECK (jsonb_typeof(options) = 'array')
);
CREATE INDEX IF NOT EXISTS ix_questions_bank ON platform.questions (tier, is_placement, difficulty);
CREATE INDEX IF NOT EXISTS ix_questions_course ON platform.questions (course_id);

CREATE TABLE IF NOT EXISTS platform.glossary_terms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term        text NOT NULL UNIQUE,
  definition  text NOT NULL,
  related     text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Append-only version history. Nothing reaches a learner without a row here.
CREATE TABLE IF NOT EXISTS platform.content_versions (
  id            bigserial PRIMARY KEY,
  entity_type   text NOT NULL CHECK (entity_type IN ('course','lesson','question','glossary_term')),
  entity_id     uuid NOT NULL,
  version       integer NOT NULL CHECK (version > 0),
  review_state  platform.review_state NOT NULL,
  snapshot      jsonb NOT NULL,
  approved_by   text NULL,
  approved_at   timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, version)
);

-- =====================================================================
-- TENANT OWNED  ·  every table below carries tenant_id and enables RLS
-- =====================================================================

CREATE TABLE IF NOT EXISTS app.tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  primary_domain  text NOT NULL UNIQUE,
  -- Edge certificate lifecycle for the broker's own domain.
  tls_state       text NOT NULL DEFAULT 'pending'
                    CHECK (tls_state IN ('pending','verifying','issued','renewing','failed')),
  tls_expires_at  timestamptz NULL,
  brand           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- colour tokens, logo, radius
  data_region     text NOT NULL DEFAULT 'me-central-1',
  plan            text NOT NULL DEFAULT 'standard',
  crm_webhook_url text NULL,
  crm_secret      text NULL,
  -- Fair-share ceiling so one academy cannot monopolise the outbox relay.
  outbox_concurrency smallint NOT NULL DEFAULT 4 CHECK (outbox_concurrency BETWEEN 1 AND 64),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  email           text NOT NULL,
  display_name    text NOT NULL DEFAULT '',
  role            app.user_role NOT NULL DEFAULT 'learner',
  lifecycle       app.lifecycle_state NOT NULL DEFAULT 'registered',
  locale          text NOT NULL DEFAULT 'en',
  sso_subject     text NULL,
  password_hash   text NULL,
  -- Per-tier mastery, rebuilt from placement and every check since.
  skill_map       jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at    timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- The same person may hold an account at two academies. Identity is
  -- scoped to the tenant on purpose: a global unique email would let one
  -- broker infer that its trader also learns at a competitor.
  CONSTRAINT uq_users_tenant_email UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS ix_users_tenant_lifecycle ON app.users (tenant_id, lifecycle);
CREATE INDEX IF NOT EXISTS ix_users_tenant_sso ON app.users (tenant_id, sso_subject) WHERE sso_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.tenant_catalogues (
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES platform.courses(id) ON DELETE CASCADE,
  enabled     boolean NOT NULL DEFAULT true,
  position    integer NOT NULL DEFAULT 0,
  enabled_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, course_id)
);

CREATE TABLE IF NOT EXISTS app.learning_paths (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  -- baseline = placement * 0.60 + self_rating * 0.40, held per tier
  baseline    jsonb NOT NULL DEFAULT '{}'::jsonb,
  self_rating jsonb NOT NULL DEFAULT '{}'::jsonb,
  level       text NOT NULL DEFAULT 'explorer'
                CHECK (level IN ('explorer','learner','practitioner','specialist')),
  stages      jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS app.enrolments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  course_id     uuid NOT NULL REFERENCES platform.courses(id) ON DELETE CASCADE,
  -- Introducing broker attribution, captured at enrolment rather than in a
  -- cookie, so it still resolves weeks later on another device.
  ib_ref_code   text NULL,
  source        text NOT NULL DEFAULT 'organic',
  campaign      text NULL,
  progress_pct  smallint NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  state         text NOT NULL DEFAULT 'enrolled'
                  CHECK (state IN ('enrolled','in_progress','completed','abandoned')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz NULL,
  UNIQUE (tenant_id, user_id, course_id)
);
CREATE INDEX IF NOT EXISTS ix_enrolments_ib ON app.enrolments (tenant_id, ib_ref_code) WHERE ib_ref_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.quiz_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  course_id     uuid NULL REFERENCES platform.courses(id) ON DELETE SET NULL,
  kind          text NOT NULL DEFAULT 'knowledge_check'
                  CHECK (kind IN ('placement','knowledge_check','final_assessment')),
  -- The paper is drawn per attempt, so two learners never see the same one.
  question_ids  uuid[] NOT NULL DEFAULT '{}',
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb,
  correct_count smallint NOT NULL DEFAULT 0,
  total_count   smallint NOT NULL DEFAULT 0,
  passed        boolean NOT NULL DEFAULT false,
  stars         smallint NOT NULL DEFAULT 0 CHECK (stars BETWEEN 0 AND 3),
  -- Integrity signals, recorded not enforced. A person reviews them.
  focus_losses  smallint NOT NULL DEFAULT 0,
  duration_ms   integer NOT NULL DEFAULT 0,
  started_at    timestamptz NOT NULL DEFAULT now(),
  submitted_at  timestamptz NULL
);
CREATE INDEX IF NOT EXISTS ix_attempts_user ON app.quiz_attempts (tenant_id, user_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS app.certificates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  course_id     uuid NOT NULL REFERENCES platform.courses(id) ON DELETE RESTRICT,
  -- Globally unique so the public verification page works without a login
  -- and without revealing which academy the holder belongs to.
  serial        text NOT NULL UNIQUE,
  holder_name   text NOT NULL,
  course_title  text NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NULL,
  revoked_at    timestamptz NULL,
  revoke_reason text NULL,
  UNIQUE (tenant_id, user_id, course_id)
);
CREATE INDEX IF NOT EXISTS ix_certificates_serial ON app.certificates (serial);

CREATE TABLE IF NOT EXISTS app.assistant_dialogs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  question        text NOT NULL,
  answer          text NOT NULL DEFAULT '',
  -- Which approved lessons the answer was grounded in. Empty means the
  -- coach declined rather than improvised.
  source_ids      uuid[] NOT NULL DEFAULT '{}',
  verdict         app.guardrail_verdict NOT NULL,
  ingress_reason  text NULL,
  egress_reason   text NULL,
  model           text NOT NULL DEFAULT '',
  latency_ms      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_dialogs_verdict ON app.assistant_dialogs (tenant_id, verdict, created_at DESC);

-- ---------------------------------------------------------------------
-- Tamper-evident audit log.
-- Each row is hashed together with the hash of the previous row for the
-- same tenant, so a deleted or edited row breaks the chain detectably.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.system_audit_log (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  seq         bigint NOT NULL,
  actor       text NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash   text NOT NULL,
  hash        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, seq)
);

-- ---------------------------------------------------------------------
-- Transactional outbox.
-- Written in the SAME transaction as the business record it describes.
-- If the event is missing, the business record never happened either.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.outbox_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  -- Stable across retries, so a duplicate delivery creates one lead and
  -- one commission credit at the far end, never two.
  idempotency_key text NOT NULL,
  status          app.outbox_status NOT NULL DEFAULT 'pending',
  retry_count     smallint NOT NULL DEFAULT 0,
  -- Ordering key so events for one learner arrive in sequence.
  partition_key   text NOT NULL DEFAULT '',
  available_at    timestamptz NOT NULL DEFAULT now(),
  locked_at       timestamptz NULL,
  locked_by       text NULL,
  last_error      text NULL,
  delivered_at    timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_outbox_idem UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_outbox_claim
  ON app.outbox_events (tenant_id, available_at)
  WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS ix_outbox_dead ON app.outbox_events (status) WHERE status = 'dead';
