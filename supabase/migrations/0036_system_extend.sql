-- 0036_system_extend.sql
-- Purpose: Rename workflow_transitions -> audit_log; add action / diff_json /
--   tamper-evident hash columns. Extend the entity_type CHECK and the
--   notification_event_type + comment_entity_type enums. Create generic
--   attachments table + saved_views. Migrate quote_attachments rows into
--   attachments and replace the table with a same-named view. Extend
--   idempotency_keys schema for response_jsonb / route_hash columns.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   ALTER TABLE public.audit_log RENAME TO workflow_transitions;
--   DROP TABLE public.saved_views, public.attachments CASCADE;
--   DROP VIEW IF EXISTS public.quote_attachments;
--   ALTER TABLE public.quote_attachments_legacy RENAME TO quote_attachments;

BEGIN;

-- Rename workflow_transitions -> audit_log and extend.
ALTER TABLE IF EXISTS public.workflow_transitions RENAME TO audit_log;

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS action      text NULL,
  ADD COLUMN IF NOT EXISTS diff_json   jsonb NULL,
  ADD COLUMN IF NOT EXISTS prev_hash   text NULL,
  ADD COLUMN IF NOT EXISTS payload_hash text NULL;

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS workflow_transitions_entity_type_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_type_check
  CHECK (entity_type IN (
    'quote','project','receiving_order','production_run','shipment',
    'invoice','payment','credit_note','expense','vendor_bill',
    'lead','opportunity','customer','contact',
    'purchase_order','journal_entry','organization','org_membership'
  ));

CREATE INDEX IF NOT EXISTS idx_audit_log_org_time
  ON public.audit_log (org_id, triggered_at DESC);

-- Extend enums (must run outside a transaction for some Postgres versions;
-- using IF NOT EXISTS each).
COMMIT;
BEGIN;
ALTER TYPE public.notification_event_type ADD VALUE IF NOT EXISTS 'invoice.sent';
ALTER TYPE public.notification_event_type ADD VALUE IF NOT EXISTS 'invoice.paid';
ALTER TYPE public.notification_event_type ADD VALUE IF NOT EXISTS 'invoice.overdue';
ALTER TYPE public.notification_event_type ADD VALUE IF NOT EXISTS 'payment.received';
ALTER TYPE public.notification_event_type ADD VALUE IF NOT EXISTS 'lead.assigned';
ALTER TYPE public.notification_event_type ADD VALUE IF NOT EXISTS 'opportunity.won';
ALTER TYPE public.notification_event_type ADD VALUE IF NOT EXISTS 'expense.submitted';
COMMIT;

BEGIN;
ALTER TYPE public.comment_entity_type ADD VALUE IF NOT EXISTS 'invoice';
ALTER TYPE public.comment_entity_type ADD VALUE IF NOT EXISTS 'payment';
ALTER TYPE public.comment_entity_type ADD VALUE IF NOT EXISTS 'lead';
ALTER TYPE public.comment_entity_type ADD VALUE IF NOT EXISTS 'opportunity';
ALTER TYPE public.comment_entity_type ADD VALUE IF NOT EXISTS 'expense';
ALTER TYPE public.comment_entity_type ADD VALUE IF NOT EXISTS 'purchase_order';
ALTER TYPE public.comment_entity_type ADD VALUE IF NOT EXISTS 'vendor_bill';
COMMIT;

BEGIN;

-- Extend idempotency_keys with the route_hash + response_jsonb columns.
ALTER TABLE public.idempotency_keys
  ADD COLUMN IF NOT EXISTS route_hash    text NULL,
  ADD COLUMN IF NOT EXISTS body_hash     text NULL,
  ADD COLUMN IF NOT EXISTS response_jsonb jsonb NULL;
-- B-tree on created_at for the 24-hour expiry sweep. Partial-index
-- predicates can't reference now() (non-IMMUTABLE in the planner sense),
-- so we use a plain index; range-scan plans on the maintenance DELETE
-- (WHERE created_at < now() - interval '24 hours') work identically.
CREATE INDEX IF NOT EXISTS idx_idempotency_expiry
  ON public.idempotency_keys (created_at);

-- Generic attachments table -------------------------------------------
CREATE TABLE IF NOT EXISTS public.attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  entity_type  text NOT NULL CHECK (entity_type IN (
                 'quote','project','invoice','payment','credit_note','expense',
                 'customer','contact','lead','opportunity','purchase_order',
                 'vendor_bill','journal_entry','shipment','receiving_order','production_run'
               )),
  entity_id    uuid NOT NULL,
  file_name    text NOT NULL,
  file_path    text NOT NULL,
  bucket       text NOT NULL DEFAULT 'attachments',
  mime_type    text NULL,
  size_bytes   bigint NULL CHECK (size_bytes IS NULL OR size_bytes >= 0),
  category     text NULL,
  notes        text NULL,
  is_public    boolean NOT NULL DEFAULT false,
  uploaded_by  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NULL REFERENCES auth.users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid NULL REFERENCES auth.users(id),
  deleted_at   timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity
  ON public.attachments (entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_org
  ON public.attachments (org_id) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_attachments_updated_at
  BEFORE UPDATE ON public.attachments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Migrate quote_attachments rows into attachments, then replace the table
-- with a same-named backwards-compat view.
ALTER TABLE public.quote_attachments RENAME TO quote_attachments_legacy;

INSERT INTO public.attachments (
  id, org_id, entity_type, entity_id, file_name, file_path,
  bucket, mime_type, size_bytes, category, notes, uploaded_by, created_at
)
SELECT id, org_id, 'quote', quote_id, file_name, file_path,
       'quote-attachments', mime_type, size_bytes, category, notes, uploaded_by, created_at
  FROM public.quote_attachments_legacy
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE VIEW public.quote_attachments AS
SELECT id, org_id, entity_id AS quote_id, uploaded_by,
       file_name, file_path, mime_type, size_bytes, category, notes, created_at
  FROM public.attachments
 WHERE entity_type = 'quote' AND deleted_at IS NULL;

-- attachment_visible_to_caller helper (matches comment_entity_visible_to_caller)
CREATE OR REPLACE FUNCTION public.attachment_visible_to_caller(
  p_entity_type text, p_entity_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE v_cust uuid;
BEGIN
  IF public.is_staff() THEN RETURN true; END IF;
  v_cust := public.current_user_customer_id();
  IF v_cust IS NULL THEN RETURN false; END IF;
  CASE p_entity_type
    WHEN 'quote' THEN
      RETURN EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = p_entity_id AND q.customer_id = v_cust);
    WHEN 'project' THEN
      RETURN EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_entity_id AND p.customer_id = v_cust);
    WHEN 'invoice' THEN
      RETURN EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = p_entity_id AND i.customer_id = v_cust AND i.status NOT IN ('draft','cancelled'));
    WHEN 'payment' THEN
      RETURN EXISTS (SELECT 1 FROM public.payments p WHERE p.id = p_entity_id AND p.customer_id = v_cust);
    WHEN 'shipment' THEN
      RETURN EXISTS (SELECT 1 FROM public.shipments s JOIN public.projects p ON p.id = s.project_id WHERE s.id = p_entity_id AND p.customer_id = v_cust);
    WHEN 'customer' THEN
      RETURN p_entity_id = v_cust;
    ELSE
      RETURN false;
  END CASE;
END $$;

REVOKE EXECUTE ON FUNCTION public.attachment_visible_to_caller(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.attachment_visible_to_caller(text, uuid) TO authenticated, service_role;

-- Saved views ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saved_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope         text NOT NULL CHECK (scope IN ('personal','team','org')),
  entity        text NOT NULL,
  name          text NOT NULL,
  filters       jsonb NOT NULL DEFAULT '{}'::jsonb,
  columns       jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort          jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default    boolean NOT NULL DEFAULT false,
  is_pinned     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NULL REFERENCES auth.users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid NULL REFERENCES auth.users(id),
  deleted_at    timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_views_owner
  ON public.saved_views (owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_saved_views_entity
  ON public.saved_views (org_id, entity);
CREATE TRIGGER trg_saved_views_updated_at
  BEFORE UPDATE ON public.saved_views
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

COMMIT;
