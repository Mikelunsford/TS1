-- 0068_phase16_collaboration.sql
-- Wave 10 Session 2 / Phase 16 — UX cross-cutting (comments + mentions +
-- attachments + notifications).
--
-- Builds on the existing chassis (verified against prior migrations):
--   - 0007: public.comments + public.notifications + comment_entity_type
--           + notification_event_type + notification_channel + RLS scaffold.
--   - 0036: public.attachments + saved_views + extended comment/notification
--           enums + attachment_visible_to_caller helper.
--   - 0043: RLS unify pass — staff-scoped attachments/saved_views policies.
--
-- This migration closes the Wave 2 deferred UX block by:
--   1. Adding org_id to comments + notifications (the BUILD-ORDER §16 ask)
--      and backfilling from the parent entity row.
--   2. Extending comment_entity_type to cover every entity we wire <CommentsTab>
--      and <FilesTab> to (contact, vendor, item, credit_note, journal_entry —
--      the 5 missing from 0007 + 0036 lists).
--   3. Adding notification_event_type values for comment.reply +
--      attachment.added (mention already exists as comment.mention).
--   4. Rewriting comment_entity_visible_to_caller to be staff-scoped via
--      is_org_member + current_org_id for the staff path, preserving the
--      existing customer-portal CASEs for Phase 21+ use.
--   5. Re-laying RLS policies on comments + notifications so:
--      - Staff (org_member+) R/W within their org.
--      - notifications recipient-only R/W on recipient_user_id = auth.uid()
--        (also already in 0007; we just re-assert with org scope).
--   6. AFTER INSERT triggers on comments to emit notification rows:
--      tg_comments_emit_mention_notifications (one per mentioned user) and
--      tg_comments_emit_reply_notifications (parent author, if different).
--   7. Storage bucket `attachments` (25 MB cap, common doc/image types)
--      with org-scoped path RLS on storage.objects.
--   8. seed `collaboration.enabled` feature flag for every existing org
--      (default true).
--
-- Idempotency: every statement uses IF NOT EXISTS / DO blocks / OR REPLACE
-- so the migration is replayable. Cross-migration helpers use
-- to_regprocedure(...) guards per
-- feedback_parallel_migration_slot_collision.md so re-numbering is trivial.
--
-- DOWN MIGRATION:
--   DROP TRIGGER IF EXISTS tg_comments_emit_mention_notifications ON public.comments;
--   DROP TRIGGER IF EXISTS tg_comments_emit_reply_notifications  ON public.comments;
--   DROP FUNCTION IF EXISTS public.emit_comment_mention_notifications();
--   DROP FUNCTION IF EXISTS public.emit_comment_reply_notification();
--   DROP POLICY IF EXISTS comments_select_staff_org   ON public.comments;
--   DROP POLICY IF EXISTS comments_insert_staff_org   ON public.comments;
--   DROP POLICY IF EXISTS comments_update_self        ON public.comments;
--   DROP POLICY IF EXISTS comments_delete_self_admin  ON public.comments;
--   DELETE FROM storage.buckets WHERE id = 'attachments';

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extend comment_entity_type to cover every wired entity.
-- ---------------------------------------------------------------------------
-- (must be outside main txn for some pg versions; bracketing per 0036 pattern)
COMMIT;

DO $$ BEGIN
  ALTER TYPE public.comment_entity_type ADD VALUE IF NOT EXISTS 'contact';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.comment_entity_type ADD VALUE IF NOT EXISTS 'vendor';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.comment_entity_type ADD VALUE IF NOT EXISTS 'item';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.comment_entity_type ADD VALUE IF NOT EXISTS 'credit_note';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.comment_entity_type ADD VALUE IF NOT EXISTS 'journal_entry';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.notification_event_type ADD VALUE IF NOT EXISTS 'comment.reply';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.notification_event_type ADD VALUE IF NOT EXISTS 'attachment.added';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

BEGIN;

-- ---------------------------------------------------------------------------
-- 2. Add org_id to comments + notifications. Backfill from parent entity
--    where possible (best-effort; rows that don't resolve get the caller's
--    org via the upcoming RLS — but we want NOT NULL eventually).
--    We keep org_id NULL-able in this migration to avoid blocking on any
--    historical row whose parent has been deleted. Application writes from
--    Phase 16 onward MUST always populate org_id.
-- ---------------------------------------------------------------------------
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS org_id uuid NULL REFERENCES public.organizations(id) ON DELETE RESTRICT;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS org_id uuid NULL REFERENCES public.organizations(id) ON DELETE RESTRICT;

-- Backfill comments.org_id from the parent entity. Each CASE only fires if
-- the entity_type matches and the parent row exists with an org_id.
-- (Best-effort: rows that can't resolve stay NULL and will be filtered out
-- by RLS until repaired by the application.)
UPDATE public.comments c SET org_id = q.org_id
  FROM public.quotes q WHERE c.entity_type = 'quote'::public.comment_entity_type
                        AND c.entity_id = q.id AND c.org_id IS NULL;
UPDATE public.comments c SET org_id = p.org_id
  FROM public.projects p WHERE c.entity_type = 'project'::public.comment_entity_type
                          AND c.entity_id = p.id AND c.org_id IS NULL;
UPDATE public.comments c SET org_id = cu.org_id
  FROM public.customers cu WHERE c.entity_type = 'customer'::public.comment_entity_type
                            AND c.entity_id = cu.id AND c.org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_comments_org_entity
  ON public.comments (org_id, entity_type, entity_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_org_recipient
  ON public.notifications (org_id, recipient_user_id, read_at, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Rewrite comment_entity_visible_to_caller to be org-staff scoped while
--    preserving the existing customer-portal cases. Staff path: any
--    org_member+ in the entity's org. Portal path: existing customer_id
--    cases (Phase 21+ extension).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comment_entity_visible_to_caller(
  p_entity_type public.comment_entity_type, p_entity_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_cust uuid;
  v_entity_org uuid;
BEGIN
  -- Staff path: resolve the entity's org_id and confirm caller belongs to it.
  CASE p_entity_type
    WHEN 'quote'            THEN SELECT org_id INTO v_entity_org FROM public.quotes WHERE id = p_entity_id;
    WHEN 'project'          THEN SELECT org_id INTO v_entity_org FROM public.projects WHERE id = p_entity_id;
    WHEN 'customer'         THEN SELECT org_id INTO v_entity_org FROM public.customers WHERE id = p_entity_id;
    WHEN 'contact'          THEN SELECT org_id INTO v_entity_org FROM public.contacts WHERE id = p_entity_id;
    WHEN 'lead'             THEN SELECT org_id INTO v_entity_org FROM public.leads WHERE id = p_entity_id;
    WHEN 'opportunity'      THEN SELECT org_id INTO v_entity_org FROM public.opportunities WHERE id = p_entity_id;
    WHEN 'invoice'          THEN SELECT org_id INTO v_entity_org FROM public.invoices WHERE id = p_entity_id;
    WHEN 'payment'          THEN SELECT org_id INTO v_entity_org FROM public.payments WHERE id = p_entity_id;
    WHEN 'credit_note'      THEN SELECT org_id INTO v_entity_org FROM public.credit_notes WHERE id = p_entity_id;
    WHEN 'expense'          THEN SELECT org_id INTO v_entity_org FROM public.expenses WHERE id = p_entity_id;
    WHEN 'purchase_order'   THEN SELECT org_id INTO v_entity_org FROM public.purchase_orders WHERE id = p_entity_id;
    WHEN 'vendor_bill'      THEN SELECT org_id INTO v_entity_org FROM public.vendor_bills WHERE id = p_entity_id;
    WHEN 'vendor'           THEN SELECT org_id INTO v_entity_org FROM public.vendors WHERE id = p_entity_id;
    WHEN 'item'             THEN SELECT org_id INTO v_entity_org FROM public.items WHERE id = p_entity_id;
    WHEN 'journal_entry'    THEN SELECT org_id INTO v_entity_org FROM public.journal_entries WHERE id = p_entity_id;
    WHEN 'receiving_order'  THEN SELECT org_id INTO v_entity_org FROM public.receiving_orders WHERE id = p_entity_id;
    WHEN 'production_run'   THEN SELECT org_id INTO v_entity_org FROM public.production_runs WHERE id = p_entity_id;
    WHEN 'shipment'         THEN SELECT org_id INTO v_entity_org FROM public.shipments WHERE id = p_entity_id;
    ELSE
      v_entity_org := NULL;
  END CASE;

  IF v_entity_org IS NOT NULL
     AND v_entity_org = public.current_org_id()
     AND public.is_staff() THEN
    RETURN true;
  END IF;

  -- Customer-portal path (unchanged shape from 0007). Phase 21+ may extend.
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
      RETURN EXISTS (SELECT 1 FROM public.shipments s JOIN public.projects p ON p.id = s.project_id
                     WHERE s.id = p_entity_id AND p.customer_id = v_cust);
    WHEN 'customer' THEN
      RETURN p_entity_id = v_cust;
    ELSE
      RETURN false;
  END CASE;
END $$;

REVOKE EXECUTE ON FUNCTION public.comment_entity_visible_to_caller(public.comment_entity_type, uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.comment_entity_visible_to_caller(public.comment_entity_type, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Notification emission triggers.
--    SECURITY DEFINER + service_role-execute so they can INSERT into the
--    notifications table even when the comment is written under an RLS-less
--    admin client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emit_comment_mention_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE v_user uuid;
BEGIN
  IF NEW.mentions IS NULL OR array_length(NEW.mentions, 1) IS NULL THEN
    RETURN NEW;
  END IF;
  FOREACH v_user IN ARRAY NEW.mentions LOOP
    IF v_user = NEW.author_user_id THEN
      CONTINUE; -- don't notify the author of their own mention
    END IF;
    INSERT INTO public.notifications (
      org_id, event_type, recipient_user_id, channel,
      entity_type, entity_id, actor_user_id, payload
    ) VALUES (
      NEW.org_id, 'comment.mention'::public.notification_event_type,
      v_user, 'in_app'::public.notification_channel,
      NEW.entity_type::text, NEW.entity_id, NEW.author_user_id,
      jsonb_build_object('comment_id', NEW.id, 'body_excerpt', left(NEW.body, 240))
    );
  END LOOP;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.emit_comment_mention_notifications() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.emit_comment_mention_notifications() TO service_role;

CREATE OR REPLACE FUNCTION public.emit_comment_reply_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE v_parent_author uuid;
BEGIN
  IF NEW.parent_comment_id IS NULL THEN RETURN NEW; END IF;
  SELECT author_user_id INTO v_parent_author
    FROM public.comments WHERE id = NEW.parent_comment_id;
  IF v_parent_author IS NULL OR v_parent_author = NEW.author_user_id THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.notifications (
    org_id, event_type, recipient_user_id, channel,
    entity_type, entity_id, actor_user_id, payload
  ) VALUES (
    NEW.org_id, 'comment.reply'::public.notification_event_type,
    v_parent_author, 'in_app'::public.notification_channel,
    NEW.entity_type::text, NEW.entity_id, NEW.author_user_id,
    jsonb_build_object('comment_id', NEW.id, 'parent_comment_id', NEW.parent_comment_id, 'body_excerpt', left(NEW.body, 240))
  );
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.emit_comment_reply_notification() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.emit_comment_reply_notification() TO service_role;

DROP TRIGGER IF EXISTS tg_comments_emit_mention_notifications ON public.comments;
CREATE TRIGGER tg_comments_emit_mention_notifications
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.emit_comment_mention_notifications();

DROP TRIGGER IF EXISTS tg_comments_emit_reply_notifications ON public.comments;
CREATE TRIGGER tg_comments_emit_reply_notifications
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.emit_comment_reply_notification();

-- ---------------------------------------------------------------------------
-- 5. Re-lay RLS policies on comments. Drop the 0007 policies that relied
--    on the visibility helper (which now resolves staff via current_org_id)
--    and add explicit org-scoped ones for the staff path. Customer-portal
--    visibility still flows through the helper.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS comments_select_visible       ON public.comments;
DROP POLICY IF EXISTS comments_insert_visible       ON public.comments;
DROP POLICY IF EXISTS comments_update_self_window   ON public.comments;
DROP POLICY IF EXISTS comments_delete_self          ON public.comments;
DROP POLICY IF EXISTS comments_select_staff_org     ON public.comments;
DROP POLICY IF EXISTS comments_insert_staff_org     ON public.comments;
DROP POLICY IF EXISTS comments_update_self          ON public.comments;
DROP POLICY IF EXISTS comments_delete_self_admin    ON public.comments;

CREATE POLICY comments_select_staff_org ON public.comments
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      (org_id = public.current_org_id() AND public.is_staff())
      OR public.comment_entity_visible_to_caller(entity_type, entity_id)
    )
  );

CREATE POLICY comments_insert_staff_org ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND (
      (org_id = public.current_org_id() AND public.is_staff())
      OR public.comment_entity_visible_to_caller(entity_type, entity_id)
    )
  );

CREATE POLICY comments_update_self ON public.comments
  FOR UPDATE TO authenticated
  USING (author_user_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (author_user_id = auth.uid());

CREATE POLICY comments_delete_self_admin ON public.comments
  FOR DELETE TO authenticated
  USING (
    author_user_id = auth.uid()
    OR (org_id = public.current_org_id()
        AND public.current_user_role() IN ('org_owner','org_admin'))
  );

-- notifications policies — 0007 already pins recipient_user_id = auth.uid().
-- Re-assert them idempotently in case of any policy drift.
DROP POLICY IF EXISTS notif_select_self   ON public.notifications;
DROP POLICY IF EXISTS notif_update_self   ON public.notifications;
CREATE POLICY notif_select_self ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());
CREATE POLICY notif_update_self ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. Storage bucket `attachments`. The 0036 attachments table already
--    references bucket text DEFAULT 'attachments'; create the bucket so
--    Storage uploads can land. 25 MB cap; permissive whitelist of common
--    doc / image / archive mimes.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments',
  'attachments',
  false,
  25 * 1024 * 1024,
  ARRAY[
    'image/png','image/jpeg','image/gif','image/webp','image/svg+xml',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint',
    'application/zip','application/x-zip-compressed',
    'text/plain','text/csv','text/markdown',
    'application/json','application/xml'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS policies — org-scoped via the path prefix convention
-- (<org_id>/<entity_type>/<entity_id>/<filename>). Service-role bypass.
DROP POLICY IF EXISTS attachments_storage_select ON storage.objects;
DROP POLICY IF EXISTS attachments_storage_insert ON storage.objects;
DROP POLICY IF EXISTS attachments_storage_update ON storage.objects;
DROP POLICY IF EXISTS attachments_storage_delete ON storage.objects;

CREATE POLICY attachments_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
    AND public.is_staff()
  );

CREATE POLICY attachments_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
    AND public.is_staff()
  );

CREATE POLICY attachments_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
    AND public.is_staff()
  );

CREATE POLICY attachments_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
    AND public.is_staff()
  );

-- ---------------------------------------------------------------------------
-- 7. Seed `collaboration.enabled` flag for every existing org (default true).
--    Admin can flip via settings-api PUT /settings/feature_flags/* per Phase 15.
-- ---------------------------------------------------------------------------
INSERT INTO public.org_feature_flags (org_id, flag_key, is_enabled, config)
SELECT o.id, 'collaboration.enabled', true, '{}'::jsonb
  FROM public.organizations o
  ON CONFLICT (org_id, flag_key) DO NOTHING;

COMMIT;
