-- 0009_secure_replace_quote_line_items.sql
-- Purpose: REVOKE hotfix. Postgres grants EXECUTE on public-schema functions
--   to PUBLIC by default; REVOKE FROM PUBLIC alone does NOT strip the grants
--   that the supabase roles 'anon' and 'authenticated' may have. This file
--   makes the lockdown explicit and is the canonical pattern reused for every
--   SECURITY DEFINER function created hereafter.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   GRANT EXECUTE ON FUNCTION public.replace_quote_line_items(uuid, jsonb)
--     TO authenticated, anon;

BEGIN;

REVOKE EXECUTE ON FUNCTION public.replace_quote_line_items(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.replace_quote_line_items(uuid, jsonb)
  TO service_role;

COMMIT;
