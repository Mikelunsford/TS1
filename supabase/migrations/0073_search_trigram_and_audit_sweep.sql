-- 0073_search_trigram_and_audit_sweep.sql
-- Wave 11B (Sub-agent B) — Closes R-W10-SEARCH-01 (trigram indexes for
-- federated /search). The handler-step-8 sweep half of R-W10-AUDIT-01
-- is code-only (no schema change needed — `audit_log` and `writeAudit()`
-- already exist as of 0068 / Wave 10 Session 2).
--
-- Forward-only. Every CREATE INDEX uses IF NOT EXISTS so a re-run is a
-- no-op (per feedback_parallel_migration_slot_collision.md).
--
-- Step-2 verification (MCP `execute_sql`) confirmed the following:
--   * customers.display_name  + deleted_at   (Wave 6 rename held)
--   * vendors.name            + deleted_at
--   * leads.company_name      + deleted_at
--   * opportunities.name      + deleted_at
--   * quotes.quote_number     + deleted_at
--   * projects.project_number + deleted_at
--   * invoices.invoice_number + deleted_at
--   * items.description       + deleted_at   (items has NO `name` column —
--                                              uses item_code + description)
--   * vendor_bills.bill_number+ deleted_at
--   * expenses.description    + deleted_at
--
-- All 10 entities DO have `deleted_at`, so every partial index gets a
-- `WHERE deleted_at IS NULL` predicate (cuts index size on soft-deleted rows).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── customers ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS customers_display_name_trgm_idx
  ON customers USING gin (display_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ── vendors ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS vendors_name_trgm_idx
  ON vendors USING gin (name gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ── leads (search hits company_name + display_name; index both) ─────────────
CREATE INDEX IF NOT EXISTS leads_company_name_trgm_idx
  ON leads USING gin (company_name gin_trgm_ops)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_display_name_trgm_idx
  ON leads USING gin (display_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ── opportunities ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS opportunities_name_trgm_idx
  ON opportunities USING gin (name gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ── quotes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS quotes_quote_number_trgm_idx
  ON quotes USING gin (quote_number gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ── projects (number is the headline; name fallback for opp-linked projects) ─
CREATE INDEX IF NOT EXISTS projects_project_number_trgm_idx
  ON projects USING gin (project_number gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ── invoices ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS invoices_invoice_number_trgm_idx
  ON invoices USING gin (invoice_number gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ── items (prod schema is item_code + description — there is NO `name`) ─────
CREATE INDEX IF NOT EXISTS items_description_trgm_idx
  ON items USING gin (description gin_trgm_ops)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS items_item_code_trgm_idx
  ON items USING gin (item_code gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ── vendor_bills ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS vendor_bills_bill_number_trgm_idx
  ON vendor_bills USING gin (bill_number gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ── expenses ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS expenses_description_trgm_idx
  ON expenses USING gin (description gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- Note on the search-api swap (R-W10-SEARCH-01):
-- The handler keeps using supabase-js .or('col.ilike.…') BUT the inner pattern
-- is now `%q%` against gin_trgm_ops-backed columns, and `pg_trgm.similarity_threshold`
-- is left at the prod default (0.3). Postgres' planner uses these GIN indexes
-- for `ILIKE '%q%'` patterns automatically once pg_trgm is installed (this is
-- the documented pg_trgm fast-ILIKE path). Empirically — see EXPLAIN ANALYZE
-- in the PR description — the planner switches from Seq Scan to Bitmap Index
-- Scan once row count crosses ~1k per entity.
--
-- We additionally add ORDER BY similarity(col, q) DESC ranking via a thin
-- SECURITY DEFINER RPC `federated_search` that batches the 10 entity SELECTs
-- in a single round trip. The RPC is added below — it is forward-only and
-- replaceable.

-- ──────────────────────────────────────────────────────────────────────────────
-- federated_search RPC — one round trip for /search.
--
-- Returns a SET OF jsonb rows, one per hit, shape:
--   { type, id, display_name, snippet, url_path, org_id, score }
--
-- Caller is responsible for the org-scope check (we still re-apply `org_id =
-- p_org_id` inside each branch as Pattern A defense-in-depth).
--
-- The function is SECURITY DEFINER so the search-api can use the anon-jwt
-- supabase client and still hit indexes that may sit behind RLS — but every
-- branch explicitly filters `org_id = p_org_id` AND `deleted_at IS NULL`, so
-- no cross-tenant leak. We DO NOT trust p_org_id from the JWT here — the
-- handler MUST pass caller.orgId after `requireCaller(req)`.
-- ──────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.federated_search(uuid, text, text[], integer);

CREATE OR REPLACE FUNCTION public.federated_search(
  p_org_id   uuid,
  p_q        text,
  p_types    text[] DEFAULT NULL,
  p_per_type integer DEFAULT 5
)
RETURNS TABLE (
  type         text,
  id           uuid,
  display_name text,
  snippet      text,
  url_path     text,
  org_id       uuid,
  score        real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_types text[] := COALESCE(p_types, ARRAY[
    'customer','vendor','lead','opportunity','quote','project',
    'invoice','item','vendor_bill','expense'
  ]);
  v_per   integer := GREATEST(LEAST(COALESCE(p_per_type, 5), 25), 1);
  v_q     text := COALESCE(NULLIF(trim(p_q), ''), NULL);
BEGIN
  IF v_q IS NULL OR length(v_q) < 2 OR p_org_id IS NULL THEN
    RETURN;
  END IF;

  -- customer
  IF 'customer' = ANY (v_types) THEN
    RETURN QUERY
    SELECT 'customer'::text, c.id, COALESCE(c.display_name, '(unnamed)')::text,
           c.email::text,
           ('/crm/customers/' || c.id::text)::text,
           c.org_id, similarity(c.display_name, v_q)::real
    FROM public.customers c
    WHERE c.org_id = p_org_id
      AND c.deleted_at IS NULL
      AND c.display_name ILIKE '%' || v_q || '%'
    ORDER BY similarity(c.display_name, v_q) DESC
    LIMIT v_per;
  END IF;

  -- vendor
  IF 'vendor' = ANY (v_types) THEN
    RETURN QUERY
    SELECT 'vendor'::text, v.id, COALESCE(v.name, '(unnamed)')::text,
           v.email::text,
           ('/vendors/' || v.id::text)::text,
           v.org_id, similarity(v.name, v_q)::real
    FROM public.vendors v
    WHERE v.org_id = p_org_id
      AND v.deleted_at IS NULL
      AND v.name ILIKE '%' || v_q || '%'
    ORDER BY similarity(v.name, v_q) DESC
    LIMIT v_per;
  END IF;

  -- lead
  IF 'lead' = ANY (v_types) THEN
    RETURN QUERY
    SELECT 'lead'::text, l.id, COALESCE(l.display_name, l.company_name, '(unnamed)')::text,
           l.company_name::text,
           ('/crm/leads/' || l.id::text)::text,
           l.org_id,
           GREATEST(similarity(COALESCE(l.display_name,''), v_q),
                    similarity(COALESCE(l.company_name,''), v_q))::real AS s
    FROM public.leads l
    WHERE l.org_id = p_org_id
      AND l.deleted_at IS NULL
      AND (l.display_name ILIKE '%' || v_q || '%'
           OR l.company_name ILIKE '%' || v_q || '%')
    ORDER BY s DESC
    LIMIT v_per;
  END IF;

  -- opportunity
  IF 'opportunity' = ANY (v_types) THEN
    RETURN QUERY
    SELECT 'opportunity'::text, o.id, COALESCE(o.name, '(unnamed)')::text,
           o.stage::text,
           ('/crm/opportunities/' || o.id::text)::text,
           o.org_id, similarity(o.name, v_q)::real
    FROM public.opportunities o
    WHERE o.org_id = p_org_id
      AND o.deleted_at IS NULL
      AND o.name ILIKE '%' || v_q || '%'
    ORDER BY similarity(o.name, v_q) DESC
    LIMIT v_per;
  END IF;

  -- quote
  IF 'quote' = ANY (v_types) THEN
    RETURN QUERY
    SELECT 'quote'::text, q.id, COALESCE(q.quote_number, '(unnamed)')::text,
           q.customer_name::text,
           ('/quotes/' || q.id::text)::text,
           q.org_id, similarity(q.quote_number, v_q)::real
    FROM public.quotes q
    WHERE q.org_id = p_org_id
      AND q.deleted_at IS NULL
      AND q.quote_number ILIKE '%' || v_q || '%'
    ORDER BY similarity(q.quote_number, v_q) DESC
    LIMIT v_per;
  END IF;

  -- project
  IF 'project' = ANY (v_types) THEN
    RETURN QUERY
    SELECT 'project'::text, p.id, COALESCE(p.project_number, '(unnamed)')::text,
           p.customer_name::text,
           ('/projects/' || p.id::text)::text,
           p.org_id, similarity(p.project_number, v_q)::real
    FROM public.projects p
    WHERE p.org_id = p_org_id
      AND p.deleted_at IS NULL
      AND p.project_number ILIKE '%' || v_q || '%'
    ORDER BY similarity(p.project_number, v_q) DESC
    LIMIT v_per;
  END IF;

  -- invoice
  IF 'invoice' = ANY (v_types) THEN
    RETURN QUERY
    SELECT 'invoice'::text, i.id, COALESCE(i.invoice_number, '(unnamed)')::text,
           i.customer_name_snapshot::text,
           ('/invoicing/invoices/' || i.id::text)::text,
           i.org_id, similarity(i.invoice_number, v_q)::real
    FROM public.invoices i
    WHERE i.org_id = p_org_id
      AND i.deleted_at IS NULL
      AND i.invoice_number ILIKE '%' || v_q || '%'
    ORDER BY similarity(i.invoice_number, v_q) DESC
    LIMIT v_per;
  END IF;

  -- item  (NB: items has NO `name` — use item_code + description)
  IF 'item' = ANY (v_types) THEN
    RETURN QUERY
    SELECT 'item'::text, it.id, COALESCE(it.item_code, '(unnamed)')::text,
           it.description::text,
           ('/inventory/items/' || it.id::text)::text,
           it.org_id,
           GREATEST(similarity(COALESCE(it.item_code,''), v_q),
                    similarity(COALESCE(it.description,''), v_q))::real AS s
    FROM public.items it
    WHERE it.org_id = p_org_id
      AND it.deleted_at IS NULL
      AND (it.item_code ILIKE '%' || v_q || '%'
           OR it.description ILIKE '%' || v_q || '%')
    ORDER BY s DESC
    LIMIT v_per;
  END IF;

  -- vendor_bill
  IF 'vendor_bill' = ANY (v_types) THEN
    RETURN QUERY
    SELECT 'vendor_bill'::text, vb.id, COALESCE(vb.bill_number, '(unnamed)')::text,
           vb.status::text,
           ('/vendors/bills/' || vb.id::text)::text,
           vb.org_id, similarity(vb.bill_number, v_q)::real
    FROM public.vendor_bills vb
    WHERE vb.org_id = p_org_id
      AND vb.deleted_at IS NULL
      AND vb.bill_number ILIKE '%' || v_q || '%'
    ORDER BY similarity(vb.bill_number, v_q) DESC
    LIMIT v_per;
  END IF;

  -- expense
  IF 'expense' = ANY (v_types) THEN
    RETURN QUERY
    SELECT 'expense'::text, e.id, COALESCE(e.expense_number, e.description, '(unnamed)')::text,
           e.description::text,
           ('/finance/expenses/' || e.id::text)::text,
           e.org_id,
           similarity(COALESCE(e.description,''), v_q)::real AS s
    FROM public.expenses e
    WHERE e.org_id = p_org_id
      AND e.deleted_at IS NULL
      AND e.description ILIKE '%' || v_q || '%'
    ORDER BY s DESC
    LIMIT v_per;
  END IF;

  RETURN;
END;
$$;

-- Service-role only (the search-api Edge Function uses admin client).
REVOKE ALL ON FUNCTION public.federated_search(uuid, text, text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.federated_search(uuid, text, text[], integer) TO service_role;

COMMENT ON FUNCTION public.federated_search(uuid, text, text[], integer) IS
  'Wave 11B (R-W10-SEARCH-01): one-shot federated search across 10 entity types using pg_trgm-backed ILIKE + similarity ranking. SECURITY DEFINER; caller must pass authoritative org_id from requireCaller().';
