-- 0070_phase19_pdf_email.sql
-- Wave 10 Session 3 / Phase 19 — PDF render engine + email delivery engine.
--
-- Step-2 verification against prior migrations:
--   - notifications table + notification_channel enum (in_app|email) exist
--     from 0007. `delivered_at` column already exists from 0007.
--   - 0036/0069 extended notification_event_type with the values we need
--     (attachment.added, comment.reply, invoice.sent, etc.).
--   - org_settings (composite PK shape) ships from 0066; seed_org_settings
--     covers company/invoicing/quoting/finance/branding/clients groups but
--     NOT yet `email` — added below.
--   - No `pdfs` Storage bucket. The only bucket today is `attachments`
--     (0069). We create `pdfs` here.
--   - No pg_cron / pg_net usage anywhere in migrations to date. Both
--     extensions are added IF NOT EXISTS below.
--
-- This migration does:
--   1. Create `pdfs` Storage bucket (50 MiB, application/pdf only, private)
--      with org-scoped path RLS on storage.objects.
--   2. Add `failed_at` + `failure_reason` to public.notifications (channel
--      already exists; delivered_at already exists).
--   3. Extend `seed_org_settings` to seed `email.provider='resend'`
--      defaults. Backfill same row for every existing org.
--   4. Enable pg_cron + pg_net extensions IF NOT EXISTS.
--   5. Schedule the notifications-worker drain cron job (every minute).
--      The shared secret is read from a per-database GUC
--      `app.notifications_worker_secret` — operator sets this once via
--      `ALTER DATABASE <db> SET app.notifications_worker_secret = '<secret>'`
--      and the matching Edge Function env var `NOTIFICATIONS_WORKER_SECRET`
--      via `supabase secrets set` (post-merge orchestrator step).
--      Until the GUC is set, current_setting(...,true) returns NULL and the
--      worker rejects the call — safe-by-default.
--
-- Idempotency: all statements use IF NOT EXISTS / DO blocks / cron.unschedule
-- guards so the migration is replayable.
--
-- DOWN MIGRATION:
--   SELECT cron.unschedule('notifications-worker-drain');
--   ALTER TABLE public.notifications DROP COLUMN IF EXISTS failed_at,
--                                    DROP COLUMN IF EXISTS failure_reason;
--   DELETE FROM storage.buckets WHERE id = 'pdfs';
--   -- (pg_cron/pg_net are platform-wide; do not drop.)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extensions for the scheduled drain.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- 2. notifications: add failed_at + failure_reason for delivery telemetry.
--    channel + delivered_at already exist from 0007.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS failed_at      timestamptz NULL;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS failure_reason text NULL;

-- Index for the drain query: outstanding email notifications ordered by age.
CREATE INDEX IF NOT EXISTS idx_notifications_email_pending
  ON public.notifications (created_at ASC)
  WHERE channel = 'email'::public.notification_channel
    AND delivered_at IS NULL
    AND failed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Storage bucket `pdfs` — private, 50 MiB cap, PDF only.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pdfs',
  'pdfs',
  false,
  50 * 1024 * 1024,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS for `pdfs`. Layout convention: <org_id>/<entity_type>/<entity_id>/<timestamp>.pdf
-- Staff org-members SELECT (download via signed URL still works for any
-- caller the bucket policy allows). Writes/updates/deletes are service-role
-- only — handlers always go through admin client.
DROP POLICY IF EXISTS pdfs_storage_select ON storage.objects;
DROP POLICY IF EXISTS pdfs_storage_insert ON storage.objects;
DROP POLICY IF EXISTS pdfs_storage_update ON storage.objects;
DROP POLICY IF EXISTS pdfs_storage_delete ON storage.objects;

CREATE POLICY pdfs_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'pdfs'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
    AND public.is_staff()
  );

-- INSERT/UPDATE/DELETE: deny authenticated; service_role bypass.
-- (No policy = no access for authenticated; service_role always bypasses RLS.)

-- ---------------------------------------------------------------------------
-- 4. seed_org_settings — extend with the `email` group.
--    The function is CREATE OR REPLACE so re-runs are idempotent. The
--    INSERT inside the function is itself ON CONFLICT DO NOTHING so it
--    is safe to re-run against orgs that already have rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_org_settings(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'seed_org_settings: p_org_id NULL';
  END IF;

  INSERT INTO public.org_settings (org_id, "group", key, value) VALUES
    -- company
    (p_org_id, 'company',   'name',                          '"Team1"'::jsonb),
    (p_org_id, 'company',   'legal_name',                    'null'::jsonb),
    (p_org_id, 'company',   'tax_id',                        'null'::jsonb),
    (p_org_id, 'company',   'default_currency',              '"USD"'::jsonb),
    (p_org_id, 'company',   'timezone',                      '"America/Los_Angeles"'::jsonb),
    (p_org_id, 'company',   'country_code',                  '"US"'::jsonb),
    -- invoicing
    (p_org_id, 'invoicing', 'default_due_days',              '30'::jsonb),
    (p_org_id, 'invoicing', 'default_tax_id',                'null'::jsonb),
    (p_org_id, 'invoicing', 'default_payment_terms',         '"Net 30"'::jsonb),
    (p_org_id, 'invoicing', 'email_subject_template',        '"Invoice {{number}}"'::jsonb),
    (p_org_id, 'invoicing', 'email_body_template',           '"Please find invoice {{number}} attached."'::jsonb),
    -- quoting
    (p_org_id, 'quoting',   'approval_threshold_cents',      '2500000'::jsonb),
    (p_org_id, 'quoting',   'default_validity_days',         '30'::jsonb),
    (p_org_id, 'quoting',   'auto_convert_on_acceptance',    'false'::jsonb),
    -- finance
    (p_org_id, 'finance',   'fiscal_year_start_month',       '1'::jsonb),
    (p_org_id, 'finance',   'default_je_book_after_post',    'true'::jsonb),
    (p_org_id, 'finance',   'auto_reverse_je_on_cancellation','false'::jsonb),
    -- branding
    (p_org_id, 'branding',  'primary_color',                 '"#1f2937"'::jsonb),
    (p_org_id, 'branding',  'accent_color',                  '"#3b82f6"'::jsonb),
    (p_org_id, 'branding',  'logo_url',                      'null'::jsonb),
    (p_org_id, 'branding',  'email_footer',                  'null'::jsonb),
    -- clients
    (p_org_id, 'clients',   'client_status_options',         '["lead","active","inactive"]'::jsonb),
    (p_org_id, 'clients',   'default_client_status',         '"lead"'::jsonb),
    -- email (Phase 19)
    (p_org_id, 'email',     'provider',                      '"resend"'::jsonb),
    (p_org_id, 'email',     'from_address',                  'null'::jsonb),
    (p_org_id, 'email',     'from_name',                     'null'::jsonb),
    (p_org_id, 'email',     'reply_to',                      'null'::jsonb)
  ON CONFLICT (org_id, "group", key) DO NOTHING;
END $$;

REVOKE EXECUTE ON FUNCTION public.seed_org_settings(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.seed_org_settings(uuid) TO service_role;

-- Re-seed every existing org (idempotent — only the new email.* rows insert).
SELECT public.seed_org_settings(id) FROM public.organizations;

COMMIT;

-- ---------------------------------------------------------------------------
-- 5. pg_cron job for notifications-worker. Must run OUTSIDE the transaction
--    (pg_cron.schedule is not transactional in older pg_cron).
--    Idempotent via cron.unschedule guarded by existence check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_jobid bigint;
  v_project_ref text := 'ozvanymuzaqbexchuoxz';
BEGIN
  -- Unschedule any prior incarnation by name (idempotent).
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'notifications-worker-drain';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'notifications-worker-drain',
    '* * * * *',
    format($cmd$
      SELECT net.http_post(
        url := 'https://%s.supabase.co/functions/v1/notifications-worker/drain',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Worker-Secret', COALESCE(current_setting('app.notifications_worker_secret', true), '')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cmd$, v_project_ref)
  );
END $$;

-- ---------------------------------------------------------------------------
-- 6. Verification block. Fails loudly if anything didn't land.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bucket_exists boolean;
  v_failed_at_exists boolean;
  v_cron_exists boolean;
  v_email_provider_seeded boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'pdfs') INTO v_bucket_exists;
  IF NOT v_bucket_exists THEN
    RAISE EXCEPTION '0070 verify: pdfs Storage bucket missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'notifications'
       AND column_name = 'failed_at'
  ) INTO v_failed_at_exists;
  IF NOT v_failed_at_exists THEN
    RAISE EXCEPTION '0070 verify: notifications.failed_at column missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'notifications-worker-drain'
  ) INTO v_cron_exists;
  IF NOT v_cron_exists THEN
    RAISE EXCEPTION '0070 verify: notifications-worker-drain cron job missing';
  END IF;

  -- email.provider seeded for at least one org
  SELECT EXISTS (
    SELECT 1 FROM public.org_settings
     WHERE "group" = 'email' AND key = 'provider'
  ) INTO v_email_provider_seeded;
  IF NOT v_email_provider_seeded THEN
    RAISE EXCEPTION '0070 verify: email.provider not seeded into org_settings';
  END IF;
END $$;
