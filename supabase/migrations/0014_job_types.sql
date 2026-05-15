-- 0014_job_types.sql
-- Purpose: job_types catalog + quotes.job_type_id FK + 12 seeded job types.
--   Mirror trigger body updated to copy job_type_id into quote_versions.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   ALTER TABLE public.quote_versions DROP COLUMN job_type_id;
--   ALTER TABLE public.quotes DROP COLUMN job_type_id;
--   DROP TABLE public.job_types CASCADE;

BEGIN;

CREATE TABLE IF NOT EXISTS public.job_types (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE,
  label                text NOT NULL,
  sort_order           int NOT NULL DEFAULT 0,
  default_service_type public.service_type NOT NULL,
  required_inputs      jsonb NOT NULL DEFAULT '[]'::jsonb,
  description          text NULL,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_job_types_updated_at
  BEFORE UPDATE ON public.job_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.job_types (code, label, sort_order, default_service_type, required_inputs, description) VALUES
  ('co_pack_basic',           'Co-Pack: Basic',                  10, 'co_pack',    '["units","cases_per_unit"]'::jsonb, 'Standard co-packing'),
  ('co_pack_kitting',         'Co-Pack: Kitting',                20, 'co_pack',    '["units","kit_components"]'::jsonb, 'Multi-SKU kit assembly'),
  ('co_pack_relabel',         'Co-Pack: Relabel',                30, 'co_pack',    '["units"]'::jsonb,                  'Relabel existing inventory'),
  ('co_pack_repack',          'Co-Pack: Repack',                 40, 'co_pack',    '["units","new_count_per_case"]'::jsonb, 'Repack into different counts'),
  ('co_pack_shrink',          'Co-Pack: Shrink Wrap',            50, 'co_pack',    '["units"]'::jsonb,                  'Multi-pack shrink wrap'),
  ('co_pack_inspection',      'Co-Pack: Inspection / QC',        60, 'co_pack',    '["units"]'::jsonb,                  'Inspection + rework'),
  ('co_pack_palletize',       'Co-Pack: Palletize',              70, 'co_pack',    '["pallets"]'::jsonb,                'Palletize and stretch'),
  ('cross_dock_standard',     'Cross-Dock: Standard',            80, 'cross_dock', '["pallets_in","pallets_out"]'::jsonb, 'Standard inbound -> outbound'),
  ('cross_dock_consolidation','Cross-Dock: Consolidation',       90, 'cross_dock', '["pallets_in","pallets_out"]'::jsonb, 'Consolidate multiple inbounds'),
  ('cross_dock_deconsol',     'Cross-Dock: Deconsolidation',    100, 'cross_dock', '["pallets_in","pallets_out"]'::jsonb, 'Split inbound into multiple outbounds'),
  ('cross_dock_transload',    'Cross-Dock: Transload',          110, 'cross_dock', '["pallets","destination"]'::jsonb,  'Floor-loaded to palletized or vice versa'),
  ('fee_setup_only',          'Fee: Setup Only',                120, 'co_pack',    '[]'::jsonb,                         'Setup or assessment fee')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS job_type_id uuid NULL REFERENCES public.job_types(id) ON DELETE SET NULL;

ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS job_type_id uuid NULL REFERENCES public.job_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_job_type ON public.quotes (job_type_id) WHERE job_type_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quote_versions_job_type ON public.quote_versions (job_type_id) WHERE job_type_id IS NOT NULL;

-- Bump mirror trigger bodies to include job_type_id.

CREATE OR REPLACE FUNCTION public.create_v1_for_quote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
BEGIN
  INSERT INTO public.quote_versions (
    quote_id, version_number, status, service_type,
    subtotal, total, notes, valid_until, created_by, job_type_id
  ) VALUES (
    NEW.id, 1, NEW.status, NEW.service_type,
    NEW.subtotal, NEW.total, NEW.notes, NEW.valid_until, NEW.created_by, NEW.job_type_id
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.mirror_quote_to_current_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.quote_versions
    WHERE quote_id = NEW.id ORDER BY version_number DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.quote_versions (
      quote_id, version_number, status, service_type,
      subtotal, total, notes, valid_until, created_by, job_type_id
    ) VALUES (
      NEW.id, 1, NEW.status, NEW.service_type,
      NEW.subtotal, NEW.total, NEW.notes, NEW.valid_until, NEW.created_by, NEW.job_type_id
    );
  ELSE
    UPDATE public.quote_versions SET
      status = NEW.status, service_type = NEW.service_type,
      subtotal = NEW.subtotal, total = NEW.total,
      notes = NEW.notes, valid_until = NEW.valid_until,
      job_type_id = NEW.job_type_id
    WHERE id = v_id;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_v1_for_quote()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mirror_quote_to_current_version() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_v1_for_quote()             TO service_role;
GRANT  EXECUTE ON FUNCTION public.mirror_quote_to_current_version() TO service_role;

ALTER TABLE public.job_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_types_select_active ON public.job_types
  FOR SELECT TO authenticated USING (is_active);

COMMIT;
