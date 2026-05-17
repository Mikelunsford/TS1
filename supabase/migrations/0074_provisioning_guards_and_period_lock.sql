-- 0074_provisioning_guards_and_period_lock.sql
-- Wave 11C: per-org seed guards + DB-enforced closed-period writes.
--
-- Closes:
--   R-W11-PROVISION-01  — seed_org_defaults today is a thin wrapper around
--                         seed_org_numbering + seed_org_settings; it does
--                         NOT call seed_org_chart_of_accounts or
--                         seed_org_default_warehouse, so new orgs come up
--                         with NO COA and NO warehouse. Wire them in, with
--                         per-org WHERE-EXISTS guards so re-running is safe.
--   R-W8E-OBS-04        — period_close (status='closed') today is only an
--                         advisory check in the period-close handler. Add a
--                         BEFORE INSERT OR UPDATE OF entry_date trigger on
--                         journal_entries that RAISEs 'period_closed' when
--                         entry_date falls inside any closed period for the
--                         same org. Trigger emits SQLSTATE P0001 which the
--                         finance-api JE handler maps to a 422 PERIOD_CLOSED
--                         envelope.
--
-- Step-2 MCP verification (read against prod 2026-05-16):
--   - seed_org_defaults body:
--       BEGIN
--         PERFORM seed_org_numbering(p_org_id);
--         PERFORM seed_org_settings(p_org_id);
--       END
--     → MISSING: COA + warehouse calls. Bug confirmed.
--   - seed_org_chart_of_accounts(uuid)  → exists
--   - seed_org_default_warehouse(uuid)  → exists
--   - period_close cols: period_start, period_end, status enum=period_close_state
--     (open|in_review|closed|reopened) — NOT start_date/end_date/state as
--     the dispatch suggested. Trigger uses period_start/period_end/status.
--   - journal_entries has entry_date column directly → trigger on the header
--     table is sufficient; journal_entry_lines does NOT carry entry_date.
--   - existing JE triggers: only trg_je_updated_at (UPDATE timestamp). The
--     Wave 8b auto-emission triggers cited in dispatch never landed; the
--     reject trigger therefore only catches direct INSERT into
--     journal_entries from the finance-api JE handler — which is what we
--     want.

-- ─── Part A: rewrite seed_org_defaults with per-org guards ────────────────────

CREATE OR REPLACE FUNCTION public.seed_org_defaults(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'seed_org_defaults: p_org_id NULL';
  END IF;

  -- Numbering sequences (existed pre-Wave-11C).
  IF to_regprocedure('public.seed_org_numbering(uuid)') IS NOT NULL THEN
    PERFORM public.seed_org_numbering(p_org_id);
  END IF;

  -- Settings rows (existed pre-Wave-11C).
  IF to_regprocedure('public.seed_org_settings(uuid)') IS NOT NULL THEN
    PERFORM public.seed_org_settings(p_org_id);
  END IF;

  -- Chart of accounts: only seed when this org has no COA yet. Guards
  -- against double-seed on re-provision retries.
  IF to_regprocedure('public.seed_org_chart_of_accounts(uuid)') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE org_id = p_org_id)
  THEN
    PERFORM public.seed_org_chart_of_accounts(p_org_id);
  END IF;

  -- Default warehouse: only seed when this org has no warehouse yet.
  IF to_regprocedure('public.seed_org_default_warehouse(uuid)') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.warehouses WHERE org_id = p_org_id)
  THEN
    PERFORM public.seed_org_default_warehouse(p_org_id);
  END IF;
END
$function$;

COMMENT ON FUNCTION public.seed_org_defaults(uuid) IS
  'Idempotent per-org seed: numbering + settings + COA + warehouse. Each step guards on org-scoped existence so re-runs on the same org are safe (Wave 11C).';

-- ─── Part B: BEFORE INSERT/UPDATE trigger on journal_entries ──────────────────

CREATE OR REPLACE FUNCTION public.tg_je_reject_closed_period()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_period_start date;
  v_period_end   date;
BEGIN
  IF NEW.entry_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pc.period_start, pc.period_end
    INTO v_period_start, v_period_end
  FROM public.period_close pc
  WHERE pc.org_id = NEW.org_id
    AND pc.status = 'closed'
    AND pc.deleted_at IS NULL
    AND NEW.entry_date BETWEEN pc.period_start AND pc.period_end
  ORDER BY pc.period_end DESC
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'period_closed: cannot post JE for % — period %..% is closed',
      NEW.entry_date, v_period_start, v_period_end
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END
$function$;

COMMENT ON FUNCTION public.tg_je_reject_closed_period() IS
  'BEFORE INSERT/UPDATE trigger: rejects journal_entries whose entry_date falls inside a closed period for the same org. Raises SQLSTATE P0001 with message prefix "period_closed:" so the finance-api JE handler can map to a 422 PERIOD_CLOSED envelope (Wave 11C, closes R-W8E-OBS-04).';

DROP TRIGGER IF EXISTS tg_journal_entries_reject_closed_period ON public.journal_entries;
CREATE TRIGGER tg_journal_entries_reject_closed_period
  BEFORE INSERT OR UPDATE OF entry_date ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_je_reject_closed_period();
