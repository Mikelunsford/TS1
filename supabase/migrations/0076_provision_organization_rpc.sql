-- Migration 0076 — single-transaction org provisioning RPC (R-W11-PROVISION-02)
--
-- Wave 11C's provisionOrganization handler in admin-console-api runs the
-- five SQL-side steps (org INSERT, membership INSERT, seed_org_defaults,
-- feature-flag upsert) as separate PostgREST calls because PostgREST has
-- no cross-statement transaction. The handler papers over this with
-- try/catch + compensating DELETEs, which works for the happy path but
-- leaves a fail-mid-provision window where (a) the org is half-seeded
-- and (b) the compensating DELETE itself can fail leaving an even worse
-- shape.
--
-- This RPC moves all five SQL steps inside a single PL/pgSQL function so
-- a fault at step N rolls back steps 1..N-1 atomically via PostgreSQL's
-- implicit-transaction-around-function-call semantics. The handler
-- keeps the Supabase auth admin calls (createUser / invite / profile
-- upsert / role lookup) outside because those touch the auth schema +
-- external services that can't participate in this SQL transaction.
--
-- Inputs:
--   p_slug                — organizations.slug
--   p_display_name        — organizations.display_name
--   p_owner_user_id       — auth.users.id (must already exist; handler
--                            invites/creates via auth.admin first)
--   p_owner_role_id       — public.roles.id for 'org_owner' (handler
--                            looks it up once)
--   p_feature_flag_keys   — text[] aligned 1:1 with p_feature_flag_enabled
--   p_feature_flag_enabled— bool[] of same length
--   p_actor_user_id       — platform_admin user_id for audit-stamp / created_by
--
-- Returns: jsonb with shape
--   { org: organizations row,
--     coa_count: int,
--     warehouse_count: int }
--
-- Errors are raised with SQLSTATE that the handler maps to wire codes:
--   23505 slug unique → STATE_CONFLICT 409
--   anything else     → INTERNAL_ERROR 500

CREATE OR REPLACE FUNCTION public.provision_organization(
  p_slug                  text,
  p_display_name          text,
  p_owner_user_id         uuid,
  p_owner_role_id         uuid,
  p_feature_flag_keys     text[],
  p_feature_flag_enabled  boolean[],
  p_actor_user_id         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org           organizations%ROWTYPE;
  v_coa_count     integer;
  v_warehouse_count integer;
  v_i             integer;
BEGIN
  IF p_slug IS NULL OR length(trim(p_slug)) = 0 THEN
    RAISE EXCEPTION 'provision_organization: p_slug required';
  END IF;
  IF p_display_name IS NULL OR length(trim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'provision_organization: p_display_name required';
  END IF;
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'provision_organization: p_owner_user_id required';
  END IF;
  IF p_owner_role_id IS NULL THEN
    RAISE EXCEPTION 'provision_organization: p_owner_role_id required';
  END IF;
  IF array_length(p_feature_flag_keys, 1) IS DISTINCT FROM array_length(p_feature_flag_enabled, 1) THEN
    RAISE EXCEPTION 'provision_organization: flag_keys and flag_enabled arrays must align';
  END IF;

  -- 1. Org row.
  INSERT INTO organizations (slug, display_name, created_by, updated_by)
  VALUES (p_slug, p_display_name, p_actor_user_id, p_actor_user_id)
  RETURNING * INTO v_org;

  -- 2. Owner membership.
  INSERT INTO org_memberships (
    org_id, user_id, role_id, is_active, joined_at, created_by, updated_by
  ) VALUES (
    v_org.id, p_owner_user_id, p_owner_role_id, true, now(), p_actor_user_id, p_actor_user_id
  );

  -- 3. seed_org_defaults — numbering + settings + COA + default warehouse,
  --    each with internal NOT EXISTS guards (per migration 0074).
  PERFORM public.seed_org_defaults(v_org.id);

  -- 4. Feature flag upsert. p_feature_flag_keys/enabled are aligned 1:1;
  --    we ON CONFLICT DO NOTHING because the seed-defaults path may have
  --    already inserted some flags (defense — current seed_org_defaults
  --    does not, but a future change might).
  IF array_length(p_feature_flag_keys, 1) IS NOT NULL THEN
    FOR v_i IN 1..array_length(p_feature_flag_keys, 1) LOOP
      INSERT INTO org_feature_flags (
        org_id, flag_key, is_enabled, config, created_by, updated_by
      ) VALUES (
        v_org.id,
        p_feature_flag_keys[v_i],
        p_feature_flag_enabled[v_i],
        '{}'::jsonb,
        p_actor_user_id,
        p_actor_user_id
      )
      ON CONFLICT (org_id, flag_key) DO UPDATE
        SET is_enabled = EXCLUDED.is_enabled,
            updated_by = EXCLUDED.updated_by,
            updated_at = now();
    END LOOP;
  END IF;

  -- 5. Hydrate seeded counts for the response envelope.
  SELECT count(*) INTO v_coa_count
    FROM chart_of_accounts WHERE org_id = v_org.id;
  SELECT count(*) INTO v_warehouse_count
    FROM warehouses WHERE org_id = v_org.id;

  RETURN jsonb_build_object(
    'org', to_jsonb(v_org),
    'coa_count', v_coa_count,
    'warehouse_count', v_warehouse_count
  );
END
$$;

COMMENT ON FUNCTION public.provision_organization(text, text, uuid, uuid, text[], boolean[], uuid) IS
  'Single-transaction org provisioning (R-W11-PROVISION-02). Wraps INSERT organization + INSERT membership + seed_org_defaults + feature flag upserts + count hydration. A fault at any step rolls back the entire org, replacing the prior PostgREST-based try/catch + compensating DELETE chain. Handler-side keeps the auth.users / profile / role-lookup operations external because they cross schemas.';

REVOKE ALL ON FUNCTION public.provision_organization(text, text, uuid, uuid, text[], boolean[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_organization(text, text, uuid, uuid, text[], boolean[], uuid) TO service_role;
