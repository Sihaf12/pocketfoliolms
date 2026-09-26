-- =====================================================================
-- Trader Academy Platform  ·  Module 4a  ·  Academy settings
--
-- An academy's brand, domain and CRM endpoint live on app.tenants, which
-- no request role may read or write (005). The studio reaches them only
-- through these functions, each acting on app.current_tenant() and
-- nothing else, each SECURITY DEFINER with a pinned search_path, each
-- executable by app_studio alone.
--
--   app.current_tenant_settings()   read: name, domain, brand, CRM URL,
--                                   and a hint of the secret, never it
--   app.set_current_tenant_brand()  write the brand (validated in the API:
--                                   the ten-token contract and contrast)
--   app.set_current_tenant_crm()    write the CRM URL (https only) and secret
--   app.domain_in_use()             is a domain taken by any academy?
--   app.apply_domain_change()       switch to a verified requested domain
--
-- Idempotent, like every migration here.
-- =====================================================================

CREATE OR REPLACE FUNCTION app.current_tenant_settings()
RETURNS TABLE (name text, primary_domain text, brand jsonb, crm_webhook_url text, crm_secret_hint text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT t.name, t.primary_domain, t.brand, t.crm_webhook_url,
         CASE WHEN t.crm_secret IS NULL THEN NULL ELSE right(t.crm_secret, 4) END
    FROM app.tenants t
   WHERE t.id = app.current_tenant()
$$;

CREATE OR REPLACE FUNCTION app.set_current_tenant_brand(p_brand jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF app.current_tenant() IS NULL THEN RAISE EXCEPTION 'no academy in scope'; END IF;
  IF jsonb_typeof(p_brand) <> 'object' OR jsonb_typeof(COALESCE(p_brand->'tokens', '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'a brand is an object with an object of tokens' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE app.tenants SET brand = p_brand WHERE id = app.current_tenant();
END $$;

-- p_secret NULL keeps the current secret; p_clear removes it.
CREATE OR REPLACE FUNCTION app.set_current_tenant_crm(p_url text, p_secret text, p_clear boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF app.current_tenant() IS NULL THEN RAISE EXCEPTION 'no academy in scope'; END IF;
  IF p_url IS NOT NULL AND p_url !~ '^https://' THEN
    RAISE EXCEPTION 'the CRM endpoint must use https' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE app.tenants
     SET crm_webhook_url = p_url,
         crm_secret = CASE WHEN p_clear THEN NULL WHEN p_secret IS NOT NULL THEN p_secret ELSE crm_secret END
   WHERE id = app.current_tenant();
END $$;

-- Whether any academy, active or not, has this domain. A domain is public
-- in DNS anyway; this says only yes or no.
CREATE OR REPLACE FUNCTION app.domain_in_use(p_domain text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM app.tenants WHERE primary_domain = lower(p_domain))
$$;

-- Switches this academy to a requested domain whose change is pending,
-- marking it verified. Only a change belonging to the academy in scope.
CREATE OR REPLACE FUNCTION app.apply_domain_change(p_change uuid, p_by uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_domain text;
BEGIN
  UPDATE app.domain_changes
     SET status = 'verified', resolved_by = p_by, resolved_at = now()
   WHERE id = p_change AND tenant_id = app.current_tenant() AND status = 'pending'
  RETURNING requested_domain INTO v_domain;
  IF v_domain IS NULL THEN
    RAISE EXCEPTION 'no pending domain change % for this academy', p_change USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE app.tenants SET primary_domain = v_domain WHERE id = app.current_tenant();
  RETURN v_domain;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['app.current_tenant_settings()', 'app.set_current_tenant_brand(jsonb)',
                           'app.set_current_tenant_crm(text, text, boolean)', 'app.domain_in_use(text)',
                           'app.apply_domain_change(uuid, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_studio', f);
  END LOOP;
END $$;
