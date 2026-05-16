-- 0055_convert_lead_rpc.sql
-- Wave 6 / F-Wave6-02 — closes R-W2-04 / F-Wave4-04.
--
-- Adds public.convert_lead(...) SECURITY DEFINER RPC that atomically
-- (a) optionally creates a customer, (b) inserts an opportunity with a
-- next_doc_number-allocated opportunity_number, (c) stamps the lead with
-- converted_customer_id + converted_opportunity_id + converted_at +
-- status='converted'. Replaces the best-effort-rollback pattern in
-- crm-api/handlers/leads.ts#convertLead with true ACID semantics.
--
-- Companion handler refactor lands in this same PR (per dispatch plan):
-- the convertLead handler shrinks to a single admin().rpc('convert_lead',
-- {...}) call.
--
-- Step-2 verification (MCP 2026-05-16):
--   set_default_tax + set_default_payment_method present (0051);
--   convert_lead absent (this migration adds).
--   leads CHECK (status IN new/contacted/qualified/disqualified/converted)
--   opportunities has opportunity_number text NOT NULL UNIQUE (org_id, opportunity_number);
--     stage CHECK (prospect/discovery/proposal/negotiation/won/lost/abandoned).
--   leads has DEFERRABLE INITIALLY DEFERRED fk_leads_opportunity from 0047,
--     so the lead → opportunity → lead-update chain commits cleanly.
--
-- The RPC accepts a p_actor_user_id parameter so caller fidelity survives
-- the service-role boundary (admin().rpc(...) has no JWT, so auth.uid()
-- returns NULL otherwise). Created_by/updated_by stamps fall back to
-- auth.uid() when p_actor is null — same pattern as
-- convert_quote_to_invoice (0052).
--
-- Forward-only.
--
-- Date:     2026-05-16
-- Sub-wave: 6.0c
-- Closes:   R-W2-04 (LeadConvert non-atomic shuffle), F-Wave4-04
--           (Wave 4 convert_lead carryover).
--
-- DOWN MIGRATION:
--   DROP FUNCTION IF EXISTS public.convert_lead(uuid, text, bigint, text, uuid, boolean, uuid);

BEGIN;

CREATE OR REPLACE FUNCTION public.convert_lead(
  p_lead_id uuid,
  p_opportunity_name text,
  p_opportunity_amount_cents bigint DEFAULT 0,
  p_opportunity_currency_code text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_create_customer boolean DEFAULT false,
  p_actor_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_lead       public.leads;
  v_customer_id uuid;
  v_opp_id      uuid;
  v_opp_number  text;
  v_currency    text;
  v_actor       uuid;
BEGIN
  v_actor := COALESCE(p_actor_user_id, auth.uid());

  -- 1. Lookup lead.
  SELECT * INTO v_lead
    FROM public.leads
   WHERE id = p_lead_id AND deleted_at IS NULL;
  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'lead % not found', p_lead_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_lead.status = 'converted' THEN
    RAISE EXCEPTION 'lead % already converted', p_lead_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_currency    := COALESCE(p_opportunity_currency_code, v_lead.currency_code);
  v_customer_id := p_customer_id;

  -- 2. Optionally create customer.
  IF p_create_customer THEN
    INSERT INTO public.customers (
      org_id, display_name, client_type, client_status,
      email, phone, currency_code, created_by, updated_by
    ) VALUES (
      v_lead.org_id,
      COALESCE(v_lead.company_name, v_lead.display_name),
      'company', 'active',
      v_lead.email, v_lead.phone, v_lead.currency_code,
      v_actor, v_actor
    ) RETURNING id INTO v_customer_id;
  END IF;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id required when p_create_customer=false'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 3. Allocate opportunity number + insert opportunity.
  v_opp_number := public.next_doc_number(v_lead.org_id, 'opportunity');

  INSERT INTO public.opportunities (
    org_id, opportunity_number, customer_id, lead_id, name, stage,
    amount_cents, currency_code, owner_user_id, created_by, updated_by
  ) VALUES (
    v_lead.org_id, v_opp_number, v_customer_id, p_lead_id,
    p_opportunity_name, 'prospect',
    p_opportunity_amount_cents, v_currency, v_lead.assigned_to,
    v_actor, v_actor
  ) RETURNING id INTO v_opp_id;

  -- 4. Stamp lead. DEFERRABLE FK from 0047 allows referencing the just-
  -- created opportunity row at commit time (this fk is named
  -- fk_leads_opportunity).
  UPDATE public.leads SET
    converted_customer_id    = v_customer_id,
    converted_opportunity_id = v_opp_id,
    converted_at             = now(),
    status                   = 'converted',
    updated_at               = now(),
    updated_by               = v_actor
  WHERE id = p_lead_id;

  RETURN jsonb_build_object(
    'lead_id',            p_lead_id,
    'customer_id',        v_customer_id,
    'opportunity_id',     v_opp_id,
    'opportunity_number', v_opp_number
  );
END $$;

COMMENT ON FUNCTION public.convert_lead(uuid, text, bigint, text, uuid, boolean, uuid) IS
  'F-Wave6-02: atomic lead-to-opportunity conversion. Optionally creates '
  'a customer (display_name = company_name OR display_name), allocates an '
  'opportunity_number via next_doc_number(org, ''opportunity''), inserts '
  'the opportunity in stage=''prospect'', then stamps the lead with '
  'converted_customer_id + converted_opportunity_id + converted_at + '
  'status=''converted''. Uses the DEFERRABLE fk_leads_opportunity FK from '
  '0047 to allow the cyclic reference. p_actor_user_id preserves caller '
  'fidelity through the service-role boundary; falls back to auth.uid().';

REVOKE EXECUTE ON FUNCTION public.convert_lead(uuid, text, bigint, text, uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.convert_lead(uuid, text, bigint, text, uuid, boolean, uuid) TO service_role;

COMMIT;
