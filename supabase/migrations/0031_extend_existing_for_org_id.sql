-- 0031_extend_existing_for_org_id.sql
-- Purpose: Add org_id NOT NULL to every TS-era tenant-scoped table.
--   Backfills with the default org id. Adds index on org_id. Renames
--   user_profiles to profiles and drops the role + customer_id columns
--   (now in org_memberships).
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   For each table: ALTER TABLE ... DROP COLUMN org_id;
--   ALTER TABLE public.profiles RENAME TO user_profiles;

BEGIN;

-- Default org id constant
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-000000000001';
        t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customers','contacts','crm_activities','quotes','quote_line_items',
    'quote_versions','quote_value_added_items','quote_attachments',
    'quote_templates','pricing_menu','pricing_tiers','customer_pricing_overrides',
    'job_types','pallet_size_kinds','value_added_kinds',
    'projects','bom_items','receiving_orders','production_runs',
    'production_build_reports','production_consumption','shipments',
    'project_dispositions','comments','notifications','workflow_transitions',
    'idempotency_keys','user_preferences'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS org_id uuid NULL REFERENCES public.organizations(id) ON DELETE RESTRICT',
      t
    );
    EXECUTE format(
      'UPDATE public.%I SET org_id = %L WHERE org_id IS NULL', t, v_org
    );
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN org_id SET NOT NULL', t
    );
  END LOOP;
END $$;

-- Indexes on org_id (partial where useful)
CREATE INDEX IF NOT EXISTS idx_customers_org              ON public.customers (org_id) WHERE is_archived = false;
CREATE INDEX IF NOT EXISTS idx_contacts_org               ON public.contacts (org_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_org         ON public.crm_activities (org_id);
CREATE INDEX IF NOT EXISTS idx_quotes_org                 ON public.quotes (org_id);
CREATE INDEX IF NOT EXISTS idx_qli_org                    ON public.quote_line_items (org_id);
CREATE INDEX IF NOT EXISTS idx_quote_versions_org         ON public.quote_versions (org_id);
CREATE INDEX IF NOT EXISTS idx_qvai_org                   ON public.quote_value_added_items (org_id);
CREATE INDEX IF NOT EXISTS idx_quote_attachments_org      ON public.quote_attachments (org_id);
CREATE INDEX IF NOT EXISTS idx_quote_templates_org        ON public.quote_templates (org_id);
CREATE INDEX IF NOT EXISTS idx_pricing_menu_org           ON public.pricing_menu (org_id);
CREATE INDEX IF NOT EXISTS idx_pricing_tiers_org          ON public.pricing_tiers (org_id);
CREATE INDEX IF NOT EXISTS idx_cpo_org                    ON public.customer_pricing_overrides (org_id);
CREATE INDEX IF NOT EXISTS idx_job_types_org              ON public.job_types (org_id);
CREATE INDEX IF NOT EXISTS idx_pallet_size_kinds_org      ON public.pallet_size_kinds (org_id);
CREATE INDEX IF NOT EXISTS idx_value_added_kinds_org      ON public.value_added_kinds (org_id);
CREATE INDEX IF NOT EXISTS idx_projects_org               ON public.projects (org_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_org              ON public.bom_items (org_id);
CREATE INDEX IF NOT EXISTS idx_receiving_orders_org       ON public.receiving_orders (org_id);
CREATE INDEX IF NOT EXISTS idx_production_runs_org        ON public.production_runs (org_id);
CREATE INDEX IF NOT EXISTS idx_pbr_org                    ON public.production_build_reports (org_id);
CREATE INDEX IF NOT EXISTS idx_pcons_org                  ON public.production_consumption (org_id);
CREATE INDEX IF NOT EXISTS idx_shipments_org              ON public.shipments (org_id);
CREATE INDEX IF NOT EXISTS idx_pdisp_org                  ON public.project_dispositions (org_id);
CREATE INDEX IF NOT EXISTS idx_comments_org_entity        ON public.comments (org_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org_recipient_unread
  ON public.notifications (org_id, recipient_user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wf_transitions_org_time
  ON public.workflow_transitions (org_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_idempotency_org_time
  ON public.idempotency_keys (org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_preferences_org       ON public.user_preferences (org_id);

-- Rename user_profiles -> profiles and drop role + customer_id (moved to memberships).
ALTER TABLE IF EXISTS public.user_profiles RENAME TO profiles;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS customer_id;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS given_name   text NULL,
  ADD COLUMN IF NOT EXISTS family_name  text NULL,
  ADD COLUMN IF NOT EXISTS photo_url    text NULL,
  ADD COLUMN IF NOT EXISTS phone        text NULL,
  ADD COLUMN IF NOT EXISTS locale       text NULL,
  ADD COLUMN IF NOT EXISTS timezone     text NULL,
  ADD COLUMN IF NOT EXISTS last_org_id  uuid NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by   uuid NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_by   uuid NULL REFERENCES auth.users(id);
-- Email becomes citext, enforced UNIQUE
DO $$ BEGIN
  ALTER TABLE public.profiles ALTER COLUMN email TYPE citext USING email::citext;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_email ON public.profiles (email);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_self ON public.profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY profiles_select_org_member ON public.profiles
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.org_memberships m1
      JOIN public.org_memberships m2 ON m2.user_id = profiles.user_id
     WHERE m1.user_id = auth.uid()
       AND m1.org_id = public.current_org_id()
       AND m2.org_id = m1.org_id
       AND m1.is_active AND m2.is_active
  ));

COMMIT;
