-- 0042_project_phases.sql
-- Purpose: project_phases child of projects with ordered position, status,
--   planned vs actual timestamps, and budget.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TABLE public.project_phases CASCADE;

BEGIN;

CREATE TABLE IF NOT EXISTS public.project_phases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  position          int NOT NULL,
  name              text NOT NULL,
  description       text NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','completed','cancelled')),
  planned_start_at  timestamptz NULL,
  planned_end_at    timestamptz NULL,
  actual_start_at   timestamptz NULL,
  actual_end_at     timestamptz NULL,
  budget_cents      bigint NOT NULL DEFAULT 0,
  notes             text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL REFERENCES auth.users(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NULL REFERENCES auth.users(id),
  deleted_at        timestamptz NULL,
  UNIQUE (project_id, position)
);
CREATE INDEX IF NOT EXISTS idx_project_phases_project
  ON public.project_phases (project_id) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_project_phases_updated_at
  BEFORE UPDATE ON public.project_phases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.project_phases ENABLE ROW LEVEL SECURITY;

COMMIT;
