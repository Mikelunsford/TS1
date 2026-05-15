-- 0019_quote_templates.sql
-- Purpose: quote_templates with optional customer scope (NULL = system).
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TABLE public.quote_templates CASCADE;

BEGIN;

CREATE TABLE IF NOT EXISTS public.quote_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  job_type_id     uuid NULL REFERENCES public.job_types(id) ON DELETE SET NULL,
  customer_id     uuid NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  service_type    public.service_type NOT NULL,
  default_inputs  jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_lines  jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes           text NULL,
  created_by      uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_templates_job_type ON public.quote_templates (job_type_id);
CREATE INDEX IF NOT EXISTS idx_quote_templates_customer ON public.quote_templates (customer_id) WHERE customer_id IS NOT NULL;

CREATE TRIGGER trg_quote_templates_updated_at
  BEFORE UPDATE ON public.quote_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.quote_templates (name, job_type_id, customer_id, service_type, default_inputs, template_lines, notes)
SELECT 'Co-Pack Starter (System)',
       (SELECT id FROM public.job_types WHERE code = 'co_pack_basic'),
       NULL,
       'co_pack',
       '{"units":1000,"cases_per_unit":12}'::jsonb,
       '[]'::jsonb,
       'Demo starter template for co-pack quotes'
WHERE NOT EXISTS (SELECT 1 FROM public.quote_templates WHERE name = 'Co-Pack Starter (System)');

ALTER TABLE public.quote_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY qtmpl_select_management ON public.quote_templates
  FOR SELECT TO authenticated USING (public.current_user_role() = 'management');
CREATE POLICY qtmpl_select_customer ON public.quote_templates
  FOR SELECT TO authenticated
  USING (customer_id IS NULL OR customer_id = public.current_user_customer_id());

COMMIT;
