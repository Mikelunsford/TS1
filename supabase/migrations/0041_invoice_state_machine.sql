-- 0041_invoice_state_machine.sql
-- Purpose: Per-transition *_at columns on invoices (pending_at, on_hold_at).
--   Audit-log trigger for invoice state changes.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TRIGGER trg_invoices_audit_state ON public.invoices;
--   DROP FUNCTION public.tg_invoice_audit_state_change();
--   ALTER TABLE public.invoices DROP COLUMN pending_at, DROP COLUMN on_hold_at;

BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pending_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS on_hold_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public.tg_invoice_audit_state_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_log (
      org_id, entity_type, entity_id, from_state, to_state,
      triggered_by, triggered_at, action, diff_json
    ) VALUES (
      NEW.org_id, 'invoice', NEW.id, OLD.status, NEW.status,
      auth.uid(), now(), 'state_change',
      jsonb_build_object('from', OLD.status, 'to', NEW.status)
    );
    IF NEW.status = 'pending'  AND NEW.pending_at IS NULL THEN NEW.pending_at := now(); END IF;
    IF NEW.status = 'on_hold'  AND NEW.on_hold_at IS NULL THEN NEW.on_hold_at := now(); END IF;
    IF NEW.status = 'sent'      AND NEW.sent_at IS NULL THEN NEW.sent_at := now(); END IF;
    IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN NEW.cancelled_at := now(); END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_invoice_audit_state_change() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tg_invoice_audit_state_change() TO service_role;

CREATE TRIGGER trg_invoices_audit_state
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_audit_state_change();

COMMIT;
