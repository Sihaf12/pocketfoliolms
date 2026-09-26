-- =====================================================================
-- Trader Academy Platform  ·  Module 4a  ·  Studio and console identity
--
--   app.users.studio_roles        a set of studio roles, not one. The
--                                 separation rule still counts people:
--                                 one person holding every role is one.
--   studio invitations            carry the set of roles they grant
--   platform.staff_invitations    single use, 72 hours, for platform staff
--   platform.staff.totp_last_step so a TOTP code is accepted only once
--
-- Idempotent, like every migration here.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Studio roles as a set. Empty means no studio access; a learner has
-- none. app.users.role stays for what it was, and is not read by the
-- studio.
-- ---------------------------------------------------------------------
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS studio_roles text[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  ALTER TABLE app.users ADD CONSTRAINT ck_users_studio_roles
    CHECK (studio_roles <@ ARRAY['author', 'reviewer', 'compliance', 'tenant_admin']::text[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_users_studio ON app.users (tenant_id) WHERE cardinality(studio_roles) > 0;

-- ---------------------------------------------------------------------
-- An invitation grants a set of roles. Accepted by someone who already
-- has an account here, it adds them to what they hold.
-- ---------------------------------------------------------------------
ALTER TABLE app.studio_invitations ADD COLUMN IF NOT EXISTS roles text[] NOT NULL DEFAULT '{}';
ALTER TABLE app.studio_invitations DROP COLUMN IF EXISTS role;
DO $$ BEGIN
  ALTER TABLE app.studio_invitations ADD CONSTRAINT ck_invitation_roles
    CHECK (cardinality(roles) > 0 AND roles <@ ARRAY['author', 'reviewer', 'compliance', 'tenant_admin']::text[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- Platform staff invitations. The owner role is not invitable: an owner
-- must hold TOTP from the moment the account exists, so owners are
-- provisioned from the command line, where TOTP is enrolled.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.staff_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL CHECK (email = lower(email)),
  role        text NOT NULL CHECK (role IN ('platform_author', 'platform_reviewer', 'platform_compliance')),
  token_hash  bytea NOT NULL UNIQUE,
  invited_by  uuid NOT NULL REFERENCES platform.staff(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '72 hours',
  accepted_at timestamptz NULL,
  revoked_at  timestamptz NULL,
  CONSTRAINT ck_staff_invitation_lifetime CHECK (expires_at > created_at AND expires_at <= created_at + interval '72 hours')
);

ALTER TABLE platform.staff_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_invitations FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS console_access ON platform.staff_invitations;
CREATE POLICY console_access ON platform.staff_invitations TO app_console USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON platform.staff_invitations TO app_console;
-- 002's default privileges would hand app_user SELECT on every new platform table.
REVOKE ALL ON platform.staff_invitations FROM app_user;

-- ---------------------------------------------------------------------
-- TOTP. The secret is stored encrypted (AES-256-GCM, key from
-- CONSOLE_TOTP_KEY), and the last accepted time step is kept so a code
-- cannot be replayed within its window.
-- ---------------------------------------------------------------------
ALTER TABLE platform.staff ADD COLUMN IF NOT EXISTS totp_last_step bigint NULL;
COMMENT ON COLUMN platform.staff.totp_secret IS 'AES-256-GCM ciphertext of the base32 TOTP secret, keyed by CONSOLE_TOTP_KEY.';

-- ---------------------------------------------------------------------
-- The control plane (provisioning, the relay) has full access to every
-- academy table, as 002 gave it. 008 wrote control_plane policies for
-- its three new tables but no grants; these complete them.
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON app.tenant_settings, app.studio_invitations, app.domain_changes TO app_control;
