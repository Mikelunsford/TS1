-- 0004_production_runs.sql
-- Purpose: production_runs, production_build_reports, production_consumption.
--   Production lifecycle timestamps on projects. Partial unique enforcing one
--   non-terminal run per project.
-- Date:    2026-05-14
-- Idempotent: CREATE IF NOT EXISTS / ADD VALUE IF NOT EXISTS.
--
-- DOWN MIGRATION:
--   DROP TABLE public.production_consumption, public.production_build_reports,
--              public.production_runs CASCADE;
--   DROP TYPE  public.production_run_state CASCADE;
--   DROP SEQUENCE public.production_run_number_seq;
--   DROP FUNCTION public.next_production_run_number();

BEGIN;
ALTER TYPE public.project_state ADD VALUE IF NOT EXISTS 'in_production';
COMMIT;

BEGIN;

DO $$ BEGIN
  CREATE TYPE public.production_run_state AS ENUM ('scheduled','in_progress','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SEQUENCE IF NOT EXISTS public.production_run_number_seq;

CREATE OR REPLACE FUNCTION public.next_production_run_number()
RETURNS text LANGUAGE sql AS $$
  SELECT 'T1-PR-' || extract(year FROM now())::text || '-' ||
         lpad(nextval('public.production_run_number_seq')::text, 4, '0')
$$;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS production_started_at   timestamptz NULL,
  ADD COLUMN IF NOT EXISTS production_completed_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS public.production_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number    text NOT NULL UNIQUE,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status        public.production_run_state NOT NULL DEFAULT 'scheduled',
  scheduled_for timestamptz NULL,
  started_at    timestamptz NULL,
  completed_at  timestamptz NULL,
  cancelled_at  timestamptz NULL,
  qty_target    numeric(12,3) NOT NULL CHECK (qty_target > 0),
  notes         text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_production_runs_project ON public.production_runs (project_id);
CREATE INDEX IF NOT EXISTS idx_production_runs_status  ON public.production_runs (status);
CREATE INDEX IF NOT EXISTS idx_production_runs_scheduled ON public.production_runs (scheduled_for);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_run_per_project
  ON public.production_runs (project_id)
  WHERE status NOT IN ('completed','cancelled');

CREATE TRIGGER trg_production_runs_updated_at
  BEFORE UPDATE ON public.production_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.production_build_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES public.production_runs(id) ON DELETE CASCADE,
  reported_at  timestamptz NOT NULL DEFAULT now(),
  reported_by  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  qty_built    numeric(12,3) NOT NULL CHECK (qty_built >= 0),
  qty_scrap    numeric(12,3) NOT NULL DEFAULT 0 CHECK (qty_scrap >= 0),
  notes        text NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_build_reports_run ON public.production_build_reports (run_id);

CREATE TRIGGER trg_production_build_reports_updated_at
  BEFORE UPDATE ON public.production_build_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.production_consumption (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_report_id uuid NOT NULL REFERENCES public.production_build_reports(id) ON DELETE CASCADE,
  bom_item_id     uuid NOT NULL REFERENCES public.bom_items(id) ON DELETE RESTRICT,
  qty_consumed    numeric(12,3) NOT NULL CHECK (qty_consumed >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consumption_report ON public.production_consumption (build_report_id);
CREATE INDEX IF NOT EXISTS idx_consumption_bom ON public.production_consumption (bom_item_id);

ALTER TABLE public.workflow_transitions DROP CONSTRAINT IF EXISTS workflow_transitions_entity_type_check;
ALTER TABLE public.workflow_transitions
  ADD CONSTRAINT workflow_transitions_entity_type_check
  CHECK (entity_type IN ('quote','project','receiving_order','production_run'));

ALTER TABLE public.production_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_build_reports   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_consumption     ENABLE ROW LEVEL SECURITY;

CREATE POLICY pruns_select_management ON public.production_runs
  FOR SELECT TO authenticated USING (public.current_user_role() = 'management');
CREATE POLICY pbuild_select_management ON public.production_build_reports
  FOR SELECT TO authenticated USING (public.current_user_role() = 'management');
CREATE POLICY pcons_select_management ON public.production_consumption
  FOR SELECT TO authenticated USING (public.current_user_role() = 'management');

COMMIT;
