-- 0007_ux_foundations.sql
-- Purpose: comments + user_preferences + notifications + pg_trgm + extra
--   user_profiles.is_active. Comment visibility helper SECURITY DEFINER.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TABLE public.notifications, public.user_preferences, public.comments CASCADE;
--   DROP TYPE  public.comment_entity_type, public.notification_event_type,
--              public.notification_channel CASCADE;
--   ALTER TABLE public.user_profiles DROP COLUMN is_active;
--   DROP FUNCTION public.comment_entity_visible_to_caller(text, uuid);
--   DROP FUNCTION public.create_user_preferences_for_profile();

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_user_profiles_role_active
  ON public.user_profiles (role) WHERE is_active;

-- Enums --------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.comment_entity_type AS ENUM (
    'quote','project','receiving_order','production_run','shipment','customer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_event_type AS ENUM (
    'quote.approved','quote.rejected','project.ready_to_build',
    'production.completed','shipment.shipped','customer.draft_submitted',
    'comment.mention'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_channel AS ENUM ('in_app','email');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Comments -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.comments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type      public.comment_entity_type NOT NULL,
  entity_id        uuid NOT NULL,
  parent_comment_id uuid NULL REFERENCES public.comments(id) ON DELETE SET NULL,
  author_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  body             text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  mentions         uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at       timestamptz NOT NULL DEFAULT now(),
  edited_at        timestamptz NULL,
  deleted_at       timestamptz NULL,
  CHECK (parent_comment_id IS NULL OR parent_comment_id <> id),
  CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);
CREATE INDEX IF NOT EXISTS idx_comments_entity ON public.comments (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_comments_author ON public.comments (author_user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON public.comments (parent_comment_id) WHERE parent_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_mentions ON public.comments USING gin (mentions);
CREATE INDEX IF NOT EXISTS idx_comments_active_recent
  ON public.comments (created_at DESC) WHERE deleted_at IS NULL;

-- Visibility helper. The "right org" check is added in 0036 when org_id lands.
CREATE OR REPLACE FUNCTION public.comment_entity_visible_to_caller(
  p_entity_type public.comment_entity_type, p_entity_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE v_role text; v_cust uuid;
BEGIN
  v_role := public.current_user_role()::text;
  v_cust := public.current_user_customer_id();
  IF v_role = 'management' THEN RETURN true; END IF;
  CASE p_entity_type
    WHEN 'quote' THEN
      RETURN EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = p_entity_id AND q.customer_id = v_cust);
    WHEN 'project' THEN
      RETURN EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_entity_id AND p.customer_id = v_cust);
    WHEN 'shipment' THEN
      RETURN EXISTS (SELECT 1 FROM public.shipments s
                     JOIN public.projects p ON p.id = s.project_id
                     WHERE s.id = p_entity_id AND p.customer_id = v_cust);
    WHEN 'customer' THEN
      RETURN p_entity_id = v_cust;
    ELSE
      RETURN false;
  END CASE;
END $$;

REVOKE EXECUTE ON FUNCTION public.comment_entity_visible_to_caller(public.comment_entity_type, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.comment_entity_visible_to_caller(public.comment_entity_type, uuid) TO authenticated, service_role;

-- User preferences ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.create_user_preferences_for_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.user_preferences (user_id) VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_user_preferences_for_profile() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_user_preferences_for_profile() TO service_role;

CREATE TRIGGER trg_user_profiles_create_preferences
  AFTER INSERT ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_user_preferences_for_profile();

-- Notifications ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type         public.notification_event_type NOT NULL,
  recipient_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel            public.notification_channel NOT NULL DEFAULT 'in_app',
  entity_type        text NULL,
  entity_id          uuid NULL,
  actor_user_id      uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  delivered_at       timestamptz NULL,
  read_at            timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON public.notifications (recipient_user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_all
  ON public.notifications (recipient_user_id, created_at DESC);

-- Trigram on quote_number for search.
CREATE INDEX IF NOT EXISTS idx_quotes_number_trgm
  ON public.quotes USING gin (quote_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_projects_number_trgm
  ON public.projects USING gin (project_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_quote_line_items_desc_trgm
  ON public.quote_line_items USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_bom_items_desc_trgm
  ON public.bom_items USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_receiving_orders_number_trgm
  ON public.receiving_orders USING gin (ro_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_production_runs_number_trgm
  ON public.production_runs USING gin (run_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking_trgm
  ON public.shipments USING gin (tracking_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_shipments_carrier_trgm
  ON public.shipments USING gin (carrier_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON public.customers USING gin (name gin_trgm_ops);

-- RLS ---------------------------------------------------------------------

ALTER TABLE public.comments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications     ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_prefs_self_all ON public.user_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY comments_select_visible ON public.comments
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL
         AND public.comment_entity_visible_to_caller(entity_type, entity_id));

CREATE POLICY comments_insert_visible ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (author_user_id = auth.uid()
              AND public.comment_entity_visible_to_caller(entity_type, entity_id));

CREATE POLICY comments_update_self_window ON public.comments
  FOR UPDATE TO authenticated
  USING (author_user_id = auth.uid() AND deleted_at IS NULL
         AND created_at > now() - interval '15 minutes')
  WITH CHECK (author_user_id = auth.uid());

CREATE POLICY comments_delete_self ON public.comments
  FOR DELETE TO authenticated
  USING (author_user_id = auth.uid());

CREATE POLICY notif_select_self ON public.notifications
  FOR SELECT TO authenticated USING (recipient_user_id = auth.uid());
CREATE POLICY notif_update_self ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

COMMIT;
