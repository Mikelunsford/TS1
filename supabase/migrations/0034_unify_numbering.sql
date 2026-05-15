-- 0034_unify_numbering.sql
-- Purpose: numbering_sequences table + next_doc_number(org_id, doc_type)
--   RPC. Seeds per-org rows for every document type. Migrates existing
--   sequence values into the default org's rows. Rebinds the previously
--   shipped convert_* RPCs to call next_doc_number().
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP FUNCTION public.next_doc_number(uuid, text);
--   DROP TABLE public.numbering_sequences CASCADE;

BEGIN;

CREATE TABLE IF NOT EXISTS public.numbering_sequences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  doc_type        text NOT NULL,
  prefix          text NOT NULL DEFAULT '',
  pad_width       int NOT NULL DEFAULT 5,
  current_value   bigint NOT NULL DEFAULT 0,
  reset_period    text NOT NULL DEFAULT 'never' CHECK (reset_period IN ('never','yearly','monthly')),
  last_reset_at   timestamptz NULL,
  current_year    int NULL,
  current_month   int NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL REFERENCES auth.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NULL REFERENCES auth.users(id),
  UNIQUE (org_id, doc_type)
);
CREATE INDEX IF NOT EXISTS idx_numbering_sequences_org ON public.numbering_sequences (org_id);
CREATE TRIGGER trg_numbering_sequences_updated_at
  BEFORE UPDATE ON public.numbering_sequences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.numbering_sequences (org_id, doc_type, prefix, pad_width, reset_period)
SELECT o.id, dt.doc_type, dt.prefix, dt.pad_width, dt.reset_period
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('quote',           'Q-',     5, 'yearly'),
    ('invoice',         'INV-',   5, 'yearly'),
    ('project',         'P-',     5, 'yearly'),
    ('payment',         'PAY-',   5, 'yearly'),
    ('credit_note',     'CN-',    5, 'yearly'),
    ('expense',         'EXP-',   5, 'yearly'),
    ('lead',            'L-',     5, 'yearly'),
    ('opportunity',     'OPP-',   5, 'yearly'),
    ('purchase_order',  'PO-',    5, 'yearly'),
    ('vendor_bill',     'VB-',    5, 'yearly'),
    ('receiving_order', 'T1-RO-', 4, 'yearly'),
    ('production_run',  'T1-PR-', 4, 'yearly'),
    ('shipment',        'T1-SH-', 4, 'yearly'),
    ('journal_entry',   'JE-',    5, 'yearly')
  ) AS dt(doc_type, prefix, pad_width, reset_period)
ON CONFLICT (org_id, doc_type) DO NOTHING;

-- Migrate legacy sequence values into the default org's rows.
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  UPDATE public.numbering_sequences ns
     SET current_value = (SELECT last_value FROM public.quote_number_seq),
         current_year = extract(year FROM now())::int
   WHERE ns.org_id = v_org AND ns.doc_type = 'quote';

  UPDATE public.numbering_sequences ns
     SET current_value = (SELECT last_value FROM public.project_number_seq),
         current_year = extract(year FROM now())::int
   WHERE ns.org_id = v_org AND ns.doc_type = 'project';

  UPDATE public.numbering_sequences ns
     SET current_value = (SELECT last_value FROM public.receiving_order_number_seq),
         current_year = extract(year FROM now())::int
   WHERE ns.org_id = v_org AND ns.doc_type = 'receiving_order';

  UPDATE public.numbering_sequences ns
     SET current_value = (SELECT last_value FROM public.production_run_number_seq),
         current_year = extract(year FROM now())::int
   WHERE ns.org_id = v_org AND ns.doc_type = 'production_run';

  UPDATE public.numbering_sequences ns
     SET current_value = (SELECT last_value FROM public.shipment_number_seq),
         current_year = extract(year FROM now())::int
   WHERE ns.org_id = v_org AND ns.doc_type = 'shipment';
END $$;

CREATE OR REPLACE FUNCTION public.next_doc_number(p_org_id uuid, p_doc_type text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.numbering_sequences%ROWTYPE;
  v_year int := extract(year FROM now())::int;
  v_month int := extract(month FROM now())::int;
  v_next bigint;
  v_segment text;
BEGIN
  SELECT * INTO v_row FROM public.numbering_sequences
   WHERE org_id = p_org_id AND doc_type = p_doc_type
   FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'No numbering sequence configured for org=% doc=%', p_org_id, p_doc_type;
  END IF;

  IF v_row.reset_period = 'yearly' AND v_row.current_year IS DISTINCT FROM v_year THEN
    v_row.current_value := 0;
    v_row.current_year := v_year;
  ELSIF v_row.reset_period = 'monthly'
        AND (v_row.current_year IS DISTINCT FROM v_year
             OR v_row.current_month IS DISTINCT FROM v_month) THEN
    v_row.current_value := 0;
    v_row.current_year := v_year;
    v_row.current_month := v_month;
  END IF;

  v_next := v_row.current_value + 1;

  UPDATE public.numbering_sequences
     SET current_value = v_next,
         current_year  = v_row.current_year,
         current_month = v_row.current_month,
         last_reset_at = CASE WHEN v_row.current_value = 0 THEN now() ELSE last_reset_at END
   WHERE id = v_row.id;

  v_segment := CASE v_row.reset_period
    WHEN 'yearly' THEN v_year::text || '-' || lpad(v_next::text, v_row.pad_width, '0')
    WHEN 'monthly' THEN v_year::text || lpad(v_month::text, 2, '0') || '-' || lpad(v_next::text, v_row.pad_width, '0')
    ELSE lpad(v_next::text, v_row.pad_width, '0')
  END;

  RETURN v_row.prefix || v_segment;
END $$;

REVOKE EXECUTE ON FUNCTION public.next_doc_number(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.next_doc_number(uuid, text) TO service_role;

-- Rebind convert_project_to_invoice to use next_doc_number().
CREATE OR REPLACE FUNCTION public.convert_project_to_invoice(
  p_project_id uuid, p_due_date date
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_org uuid; v_invoice_id uuid; v_number text;
BEGIN
  SELECT org_id INTO v_org FROM public.projects WHERE id = p_project_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'project % not found', p_project_id; END IF;
  v_number := public.next_doc_number(v_org, 'invoice');

  INSERT INTO public.invoices (
    id, org_id, invoice_number, customer_id, customer_name_snapshot,
    project_id, status, payment_status, issue_date, due_date,
    currency_code, total_cents
  )
  SELECT gen_random_uuid(), v_org, v_number, p.customer_id, p.customer_name,
         p.id, 'draft', 'unpaid', current_date, p_due_date,
         p.currency_code, p.total_cents
    FROM public.projects p WHERE p.id = p_project_id
  RETURNING id INTO v_invoice_id;

  UPDATE public.projects SET invoice_id = v_invoice_id WHERE id = p_project_id;
  RETURN v_invoice_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.convert_project_to_invoice(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.convert_project_to_invoice(uuid, date) TO service_role;

ALTER TABLE public.numbering_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY numseq_select_staff ON public.numbering_sequences
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'));

COMMIT;
