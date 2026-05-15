-- 0010_crm.sql
-- Purpose: contacts (multi-contact per customer), crm_activities log,
--   citext extension. Sets up trigram indexes for contact search.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TABLE public.crm_activities, public.contacts CASCADE;
--   DROP TYPE  public.crm_activity_type, public.crm_activity_status CASCADE;

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;

DO $$ BEGIN
  CREATE TYPE public.crm_activity_type AS ENUM ('note','task','call','email','meeting');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_activity_status AS ENUM ('open','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  first_name  text NOT NULL,
  last_name   text NOT NULL,
  email       citext NULL,
  phone       text NULL,
  title       text NULL,
  is_primary  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  notes       text NULL,
  created_by  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_primary_per_customer
  ON public.contacts (customer_id) WHERE is_primary;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_email_per_customer_active
  ON public.contacts (customer_id, email) WHERE is_active AND email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_customer_id ON public.contacts (customer_id);
CREATE INDEX IF NOT EXISTS idx_contacts_name_trgm
  ON public.contacts USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_email_trgm
  ON public.contacts USING gin (email gin_trgm_ops);

CREATE TRIGGER trg_contacts_set_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.crm_activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  contact_id    uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL,
  quote_id      uuid NULL REFERENCES public.quotes(id) ON DELETE SET NULL,
  project_id    uuid NULL REFERENCES public.projects(id) ON DELETE SET NULL,
  activity_type public.crm_activity_type NOT NULL,
  subject       text NOT NULL,
  body          text NULL,
  status        public.crm_activity_status NOT NULL DEFAULT 'open',
  due_at        timestamptz NULL,
  completed_at  timestamptz NULL,
  assigned_to   uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by    uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_activities_open_only_task_or_meeting
    CHECK (status <> 'open' OR activity_type IN ('task','meeting')),
  CONSTRAINT crm_activities_completed_has_timestamp
    CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_crm_activities_customer_created
  ON public.crm_activities (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_assignee_due
  ON public.crm_activities (assigned_to, due_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_crm_activities_contact_id
  ON public.crm_activities (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_activities_quote_id
  ON public.crm_activities (quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_activities_project_id
  ON public.crm_activities (project_id) WHERE project_id IS NOT NULL;

CREATE TRIGGER trg_crm_activities_set_updated_at
  BEFORE UPDATE ON public.crm_activities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities  ENABLE ROW LEVEL SECURITY;

CREATE POLICY contacts_select_management ON public.contacts
  FOR SELECT TO authenticated USING (public.current_user_role() = 'management');

CREATE POLICY crm_activities_select_management ON public.crm_activities
  FOR SELECT TO authenticated USING (public.current_user_role() = 'management');

COMMIT;
