-- 0075_mfa_helper_rpc.sql
-- Wave 11D hotfix: closes the 500 on every platform_admin.* endpoint.
--
-- Background: Wave 11A (PR #92) added _shared/mfa.ts which queried
-- auth.mfa_factors via the supabase-js SDK pattern
-- `sb.schema('auth').from('mfa_factors')`. But `supabase/config.toml`
-- exposes only `["public", "graphql_public"]` to PostgREST, so the SDK
-- call returns an error and the helper throws INTERNAL_ERROR 500. Every
-- platform_admin.* endpoint 500'd in prod after merge.
--
-- Fix: provide a SECURITY DEFINER wrapper in the public schema so the
-- service-role admin client can reach auth.mfa_factors via PostgREST RPC
-- without expanding the schema exposure surface.

CREATE OR REPLACE FUNCTION public.has_verified_totp(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM auth.mfa_factors
    WHERE user_id = p_user_id
      AND factor_type = 'totp'
      AND status = 'verified'
  );
$function$;

REVOKE ALL ON FUNCTION public.has_verified_totp(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_verified_totp(uuid) TO service_role;

COMMENT ON FUNCTION public.has_verified_totp(uuid) IS
  'Wave 11D fix: returns true iff the user has a verified TOTP factor in auth.mfa_factors. Wraps the auth-schema read in a SECURITY DEFINER so service_role can reach it via PostgREST without exposing auth.* to the public schema cache. Called by _shared/mfa.ts hasVerifiedTotp.';
