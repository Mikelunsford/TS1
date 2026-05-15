-- 0047_crm_audit_triggers.sql
-- Wave 2 (CRM Core) — adds:
--   1. AFTER-UPDATE audit trigger on `opportunities` that writes a row to
--      `audit_log` whenever `stage` changes (Phase 2 acceptance criteria #4
--      "An opportunity-stage change writes an audit_log row").
--   2. Symmetrical AFTER-UPDATE audit trigger on `leads` for `status` changes
--      (used by the convert flow + the kanban drag-update).
--   3. `leads.fk_leads_opportunity` re-declared as DEFERRABLE INITIALLY
--      DEFERRED so a bulk lead-conversion that inserts both opportunity AND
--      patches the lead in one transaction can commit without temporary
--      ordering acrobatics. The opportunities.lead_id FK stays
--      non-deferrable (lead is always inserted first in the conversion path).
--   4. Idempotent backfill guards for `leads.status`, `opportunities.stage`,
--      `customers.client_status` — current state has zero NULLs (NOT NULL
--      defaults from 0032 covered everything), but the COALESCE pattern
--      keeps the migration safe on a fresh DB rebuild or on a staging clone
--      that pre-dates the NOT NULL defaults.
--
-- Why `audit_log` and not `workflow_transitions`: the rename from
-- `workflow_transitions` -> `audit_log` already shipped (Phase 17 migration,
-- pre-Wave-0 chassis); `audit_log` is the live table with columns
-- (entity_type, entity_id, from_state, to_state, action, triggered_by,
-- triggered_at, org_id, ...). The Wave 2 dispatch said
-- `workflow_transitions`; the column shape is identical and the table no
-- longer exists under that name. Recording the deviation in this header for
-- the audit trail.
--
-- Date:    2026-05-15
--
-- DOWN MIGRATION:
--   DROP TRIGGER IF EXISTS trg_opportunities_audit_stage ON public.opportunities;
--   DROP TRIGGER IF EXISTS trg_leads_audit_status        ON public.leads;
--   DROP FUNCTION IF EXISTS public.fn_opportunities_audit_stage();
--   DROP FUNCTION IF EXISTS public.fn_leads_audit_status();
--   ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS fk_leads_opportunity;
--   ALTER TABLE public.leads
--     ADD CONSTRAINT fk_leads_opportunity FOREIGN KEY (converted_opportunity_id)
--     REFERENCES public.opportunities(id) ON DELETE SET NULL;

BEGIN;

-- 1. Opportunity stage-change audit ------------------------------------

CREATE OR REPLACE FUNCTION public.fn_opportunities_audit_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.audit_log (
      entity_type,
      entity_id,
      from_state,
      to_state,
      action,
      triggered_by,
      triggered_at,
      org_id,
      notes
    ) VALUES (
      'opportunity',
      NEW.id,
      OLD.stage,
      NEW.stage,
      'stage_change',
      COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid,
               NEW.updated_by),
      now(),
      NEW.org_id,
      NEW.close_reason
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_opportunities_audit_stage ON public.opportunities;
CREATE TRIGGER trg_opportunities_audit_stage
  AFTER UPDATE OF stage ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.fn_opportunities_audit_stage();

-- 2. Lead status-change audit ------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_leads_audit_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_log (
      entity_type,
      entity_id,
      from_state,
      to_state,
      action,
      triggered_by,
      triggered_at,
      org_id
    ) VALUES (
      'lead',
      NEW.id,
      OLD.status,
      NEW.status,
      'status_change',
      COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid,
               NEW.updated_by),
      now(),
      NEW.org_id
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_leads_audit_status ON public.leads;
CREATE TRIGGER trg_leads_audit_status
  AFTER UPDATE OF status ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_leads_audit_status();

-- 3. Make the lead -> opportunity FK DEFERRABLE ------------------------

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS fk_leads_opportunity;
ALTER TABLE public.leads
  ADD CONSTRAINT fk_leads_opportunity
  FOREIGN KEY (converted_opportunity_id)
  REFERENCES public.opportunities(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

-- 4. Idempotent backfill guards (no-ops in current state) -------------

UPDATE public.customers
   SET client_status = 'new'
 WHERE client_status IS NULL;

UPDATE public.leads
   SET status = 'new'
 WHERE status IS NULL;

UPDATE public.opportunities
   SET stage = 'prospect'
 WHERE stage IS NULL;

COMMIT;
