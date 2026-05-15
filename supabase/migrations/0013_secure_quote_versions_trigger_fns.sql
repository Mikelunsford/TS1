-- 0013_secure_quote_versions_trigger_fns.sql
-- Purpose: REVOKE hotfix for the mirror trigger functions. Same pattern as
--   0009. Keeps anon and authenticated from invoking the SECURITY DEFINER
--   bodies directly (triggers still fire because triggers do not require
--   EXECUTE on the function from the calling role).
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   GRANT EXECUTE ON FUNCTION public.create_v1_for_quote,
--                              public.mirror_quote_to_current_version,
--                              public.fill_line_item_version_id
--     TO authenticated, anon;

BEGIN;

REVOKE EXECUTE ON FUNCTION public.create_v1_for_quote()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mirror_quote_to_current_version()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fill_line_item_version_id()        FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_v1_for_quote()              TO service_role;
GRANT  EXECUTE ON FUNCTION public.mirror_quote_to_current_version()  TO service_role;
GRANT  EXECUTE ON FUNCTION public.fill_line_item_version_id()        TO service_role;

COMMIT;
