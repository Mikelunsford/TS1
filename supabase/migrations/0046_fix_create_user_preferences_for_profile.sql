-- 0046_fix_create_user_preferences_for_profile.sql
-- Purpose: Forward-fix a Wave 0 schema bug surfaced by the Wave 1 RLS
--   probe. The trigger function `create_user_preferences_for_profile`
--   (from migration 0007) inserts user_preferences with only `user_id`,
--   but a later migration (0029 / 0031) added `org_id NOT NULL` to
--   user_preferences without a default. As a result, any new profile
--   insert errors with:
--     'null value in column "org_id" of relation "user_preferences"'
--   This didn't surface on prod because no new users have signed up
--   since the schema added org_id. The RLS probe's ephemeral fixtures
--   trip the bug on every run.
-- Date:    2026-05-15
--
-- Fix: the function reads NEW.last_org_id and skips the user_preferences
-- insert when it's null. Once the SPA wires last_org_id at signup, the
-- preferences row is created automatically with the correct org.
--
-- DOWN MIGRATION:
--   CREATE OR REPLACE FUNCTION public.create_user_preferences_for_profile()
--   RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
--   SET search_path = public, auth
--   AS $$
--   BEGIN
--     INSERT INTO public.user_preferences (user_id) VALUES (NEW.user_id)
--       ON CONFLICT (user_id) DO NOTHING;
--     RETURN NEW;
--   END $$;

BEGIN;

CREATE OR REPLACE FUNCTION public.create_user_preferences_for_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- When a profile is created without an active-org hint we cannot
  -- populate user_preferences (org_id is NOT NULL). Skip; the row will
  -- be backfilled on first workspace switch or on next profile UPDATE
  -- when last_org_id lands.
  IF NEW.last_org_id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.user_preferences (user_id, org_id)
    VALUES (NEW.user_id, NEW.last_org_id)
    ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END $$;

COMMIT;
