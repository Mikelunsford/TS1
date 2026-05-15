-- 0043_rls_unify.sql
-- Purpose: DROP every TS-era binary-role RLS policy that survived (those
--   referencing the legacy app_role enum) and CREATE replacement policies
--   that use current_org_id() + current_user_role() + is_staff() +
--   current_user_customer_id() per /08-database/03-RLS-POLICIES.md.
--   Cross-tenant probes return zero rows (NOT FOUND), never FORBIDDEN.
-- Date:    2026-05-14
--
-- DOWN MIGRATION (operator-only):
--   For each policy below, DROP POLICY ... then recreate the TS-era binary
--   policy from 0001 / 0006 / 0010 etc. Forward-only: do not do this.

BEGIN;

-- Customers ------------------------------------------------------------
DROP POLICY IF EXISTS customers_select_management ON public.customers;
DROP POLICY IF EXISTS customers_select_self       ON public.customers;
CREATE POLICY customers_select_staff ON public.customers
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY customers_select_self ON public.customers
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id()
         AND id = public.current_user_customer_id());
CREATE POLICY customers_write_staff ON public.customers
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id()
         AND public.current_user_role() IN ('org_owner','org_admin','sales','ops','accounting'))
  WITH CHECK (org_id = public.current_org_id()
              AND public.current_user_role() IN ('org_owner','org_admin','sales','ops','accounting'));

-- Contacts -------------------------------------------------------------
DROP POLICY IF EXISTS contacts_select_management ON public.contacts;
CREATE POLICY contacts_select_staff ON public.contacts
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY contacts_select_own ON public.contacts
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id()
         AND customer_id = public.current_user_customer_id());
CREATE POLICY contacts_write_staff ON public.contacts
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id()
         AND public.current_user_role() IN ('org_owner','org_admin','sales','ops','accounting'))
  WITH CHECK (org_id = public.current_org_id()
              AND public.current_user_role() IN ('org_owner','org_admin','sales','ops','accounting'));

-- Activities -----------------------------------------------------------
DROP POLICY IF EXISTS crm_activities_select_management ON public.activities;
CREATE POLICY activities_select_staff ON public.activities
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY activities_write_staff ON public.activities
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff())
  WITH CHECK (org_id = public.current_org_id() AND public.is_staff());

-- Leads / opportunities ----------------------------------------------
CREATE POLICY leads_select_staff ON public.leads
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY leads_write_staff ON public.leads
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','sales'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','sales'));

CREATE POLICY opps_select_staff ON public.opportunities
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY opps_write_sales ON public.opportunities
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','sales'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','sales'));

-- Quotes ---------------------------------------------------------------
DROP POLICY IF EXISTS quotes_select_management         ON public.quotes;
DROP POLICY IF EXISTS quotes_select_customer           ON public.quotes;
DROP POLICY IF EXISTS quotes_insert_customer_intake    ON public.quotes;
DROP POLICY IF EXISTS quotes_update_customer_draft     ON public.quotes;
CREATE POLICY quotes_select_staff ON public.quotes
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY quotes_select_customer ON public.quotes
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id()
         AND customer_id = public.current_user_customer_id());
CREATE POLICY quotes_insert_staff ON public.quotes
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_org_id()
              AND public.current_user_role() IN ('org_owner','org_admin','sales'));
CREATE POLICY quotes_insert_customer_draft ON public.quotes
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_org_id()
              AND customer_id = public.current_user_customer_id()
              AND status = 'draft'
              AND origin = 'customer_intake');
CREATE POLICY quotes_update_staff ON public.quotes
  FOR UPDATE TO authenticated
  USING (org_id = public.current_org_id()
         AND public.current_user_role() IN ('org_owner','org_admin','sales'))
  WITH CHECK (org_id = public.current_org_id()
              AND public.current_user_role() IN ('org_owner','org_admin','sales'));
CREATE POLICY quotes_update_customer_draft ON public.quotes
  FOR UPDATE TO authenticated
  USING (org_id = public.current_org_id()
         AND customer_id = public.current_user_customer_id()
         AND status = 'draft')
  WITH CHECK (org_id = public.current_org_id()
              AND customer_id = public.current_user_customer_id()
              AND status = 'draft');

-- Quote line items ----------------------------------------------------
DROP POLICY IF EXISTS qli_select_via_parent      ON public.quote_line_items;
DROP POLICY IF EXISTS qli_write_customer_draft   ON public.quote_line_items;
CREATE POLICY qli_select_parent ON public.quote_line_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotes q
     WHERE q.id = quote_line_items.quote_id
       AND q.org_id = public.current_org_id()
       AND (public.is_staff() OR q.customer_id = public.current_user_customer_id())
  ));
CREATE POLICY qli_write_staff ON public.quote_line_items
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id()
         AND public.current_user_role() IN ('org_owner','org_admin','sales'))
  WITH CHECK (org_id = public.current_org_id()
              AND public.current_user_role() IN ('org_owner','org_admin','sales'));
CREATE POLICY qli_write_customer_draft ON public.quote_line_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotes q
     WHERE q.id = quote_line_items.quote_id
       AND q.org_id = public.current_org_id()
       AND q.customer_id = public.current_user_customer_id()
       AND q.status = 'draft'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.quotes q
     WHERE q.id = quote_line_items.quote_id
       AND q.org_id = public.current_org_id()
       AND q.customer_id = public.current_user_customer_id()
       AND q.status = 'draft'
  ));

-- Quote versions / VA / attachments / templates ----------------------
DROP POLICY IF EXISTS qv_select_management   ON public.quote_versions;
DROP POLICY IF EXISTS qv_select_customer     ON public.quote_versions;
CREATE POLICY qv_select_staff ON public.quote_versions
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY qv_select_customer ON public.quote_versions
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id()
         AND EXISTS (
           SELECT 1 FROM public.quotes q
            WHERE q.id = quote_versions.quote_id
              AND q.customer_id = public.current_user_customer_id()
              AND q.status IN ('submitted','approved','project_pending','cancelled')
         ));

DROP POLICY IF EXISTS qvai_select_management ON public.quote_value_added_items;
DROP POLICY IF EXISTS qvai_select_customer   ON public.quote_value_added_items;
CREATE POLICY qvai_select_staff ON public.quote_value_added_items
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY qvai_select_customer ON public.quote_value_added_items
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id()
         AND EXISTS (
           SELECT 1 FROM public.quote_versions v
           JOIN public.quotes q ON q.id = v.quote_id
           WHERE v.id = quote_value_added_items.quote_version_id
             AND q.customer_id = public.current_user_customer_id()
         ));

-- quote_attachments (legacy table; new is a view) -----------------
DROP POLICY IF EXISTS qatt_select_management ON public.quote_attachments_legacy;
DROP POLICY IF EXISTS qatt_select_customer   ON public.quote_attachments_legacy;
-- Tighten legacy table to staff-only (the active surface is `attachments`).
ALTER TABLE IF EXISTS public.quote_attachments_legacy ENABLE ROW LEVEL SECURITY;
CREATE POLICY qatt_legacy_select_staff ON public.quote_attachments_legacy
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());

DROP POLICY IF EXISTS qtmpl_select_management ON public.quote_templates;
DROP POLICY IF EXISTS qtmpl_select_customer   ON public.quote_templates;
CREATE POLICY qtmpl_select_staff ON public.quote_templates
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY qtmpl_select_customer ON public.quote_templates
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id()
         AND (customer_id IS NULL OR customer_id = public.current_user_customer_id()));

-- Projects / phases ----------------------------------------------------
DROP POLICY IF EXISTS projects_select_management ON public.projects;
DROP POLICY IF EXISTS projects_select_customer   ON public.projects;
CREATE POLICY projects_select_staff ON public.projects
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY projects_select_customer ON public.projects
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id()
         AND customer_id = public.current_user_customer_id());
CREATE POLICY projects_write_ops ON public.projects
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id()
         AND public.current_user_role() IN ('org_owner','org_admin','sales','ops'))
  WITH CHECK (org_id = public.current_org_id()
              AND public.current_user_role() IN ('org_owner','org_admin','sales','ops'));

CREATE POLICY phases_select_staff ON public.project_phases
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY phases_select_customer ON public.project_phases
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id()
         AND EXISTS (SELECT 1 FROM public.projects p
                      WHERE p.id = project_phases.project_id
                        AND p.customer_id = public.current_user_customer_id()));
CREATE POLICY phases_write_ops ON public.project_phases
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'));

-- 3PL operations -------------------------------------------------------
DROP POLICY IF EXISTS bom_select_management         ON public.bom_items;
DROP POLICY IF EXISTS ro_select_management          ON public.receiving_orders;
DROP POLICY IF EXISTS pruns_select_management       ON public.production_runs;
DROP POLICY IF EXISTS pbuild_select_management      ON public.production_build_reports;
DROP POLICY IF EXISTS pcons_select_management       ON public.production_consumption;
DROP POLICY IF EXISTS pdisp_select_management       ON public.project_dispositions;
DROP POLICY IF EXISTS shipments_select_management   ON public.shipments;
DROP POLICY IF EXISTS shipments_select_customer     ON public.shipments;

CREATE POLICY bom_staff_all ON public.bom_items
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops','accounting'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops','accounting'));
CREATE POLICY bom_viewer_select ON public.bom_items
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = 'viewer');

CREATE POLICY ro_staff_all ON public.receiving_orders
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'));

CREATE POLICY pruns_staff_all ON public.production_runs
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'));

CREATE POLICY pbuild_staff_all ON public.production_build_reports
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'));

CREATE POLICY pcons_staff_all ON public.production_consumption
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'));

CREATE POLICY pdisp_staff_all ON public.project_dispositions
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'));

CREATE POLICY shipments_select_staff ON public.shipments
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY shipments_select_customer ON public.shipments
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id()
         AND EXISTS (SELECT 1 FROM public.projects p
                      WHERE p.id = shipments.project_id
                        AND p.customer_id = public.current_user_customer_id()));
CREATE POLICY shipments_write_ops ON public.shipments
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'));

-- Catalog tables -------------------------------------------------------
DROP POLICY IF EXISTS job_types_select_active        ON public.job_types;
DROP POLICY IF EXISTS pallet_size_kinds_select_active ON public.pallet_size_kinds;
DROP POLICY IF EXISTS value_added_kinds_select_active ON public.value_added_kinds;

CREATE POLICY job_types_select_active ON public.job_types
  FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND is_active);
CREATE POLICY job_types_write_admin ON public.job_types
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'));

CREATE POLICY pallet_size_kinds_select_active ON public.pallet_size_kinds
  FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND is_active);
CREATE POLICY value_added_kinds_select_active ON public.value_added_kinds
  FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND is_active);

-- Sales (invoices, lines, versions, payments, credit notes) ----------
CREATE POLICY invoices_select_staff ON public.invoices
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY invoices_select_customer ON public.invoices
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id()
         AND customer_id = public.current_user_customer_id()
         AND status NOT IN ('draft','cancelled'));
CREATE POLICY invoices_write_fin ON public.invoices
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting','sales'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting','sales'));

CREATE POLICY ili_select_parent ON public.invoice_line_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i
                  WHERE i.id = invoice_line_items.invoice_id
                    AND i.org_id = public.current_org_id()
                    AND (public.is_staff()
                         OR (i.customer_id = public.current_user_customer_id()
                             AND i.status NOT IN ('draft','cancelled')))));
CREATE POLICY ili_write_fin ON public.invoice_line_items
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting','sales'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting','sales'));

CREATE POLICY iv_select_staff ON public.invoice_versions
  FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY iv_select_customer ON public.invoice_versions
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id()
         AND EXISTS (SELECT 1 FROM public.invoices i
                      WHERE i.id = invoice_versions.invoice_id
                        AND i.customer_id = public.current_user_customer_id()
                        AND i.status NOT IN ('draft','cancelled')));

CREATE POLICY payments_select_staff ON public.payments
  FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY payments_select_customer ON public.payments
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND customer_id = public.current_user_customer_id());
CREATE POLICY payments_write_fin ON public.payments
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'));

CREATE POLICY pm_select ON public.payment_methods
  FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND is_active);
CREATE POLICY pm_write_fin ON public.payment_methods
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'));

CREATE POLICY credit_notes_select_staff ON public.credit_notes
  FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY credit_notes_select_customer ON public.credit_notes
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND customer_id = public.current_user_customer_id()
         AND status NOT IN ('draft','voided'));
CREATE POLICY credit_notes_write_fin ON public.credit_notes
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'));

-- Taxes ---------------------------------------------------------------
CREATE POLICY taxes_select_active ON public.taxes
  FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND is_active);
CREATE POLICY taxes_write_fin ON public.taxes
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'));

-- Finance (CoA, journals, expenses) ----------------------------------
CREATE POLICY coa_select_fin ON public.chart_of_accounts
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'));
CREATE POLICY coa_write_fin ON public.chart_of_accounts
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'));

CREATE POLICY je_select_fin ON public.journal_entries
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'));
CREATE POLICY je_write_fin ON public.journal_entries
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'));

CREATE POLICY jel_select_fin ON public.journal_entry_lines
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'));
CREATE POLICY jel_write_fin ON public.journal_entry_lines
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'));

CREATE POLICY expenses_select_staff ON public.expenses
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY expenses_insert_self ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_org_id() AND public.is_staff() AND submitted_by = auth.uid());
CREATE POLICY expenses_update_self_draft ON public.expenses
  FOR UPDATE TO authenticated
  USING (org_id = public.current_org_id() AND submitted_by = auth.uid() AND status IN ('draft','submitted','rejected'))
  WITH CHECK (org_id = public.current_org_id() AND submitted_by = auth.uid());
CREATE POLICY expenses_approve_fin ON public.expenses
  FOR UPDATE TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'));

CREATE POLICY expense_categories_select ON public.expense_categories
  FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND is_active);
CREATE POLICY expense_categories_write_fin ON public.expense_categories
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting'));

-- Inventory ------------------------------------------------------------
DROP POLICY IF EXISTS pricing_menu_select_all ON public.pricing_menu;
DROP POLICY IF EXISTS pricing_tiers_select_all ON public.pricing_tiers;
DROP POLICY IF EXISTS cpo_select_management ON public.customer_pricing_overrides;
DROP POLICY IF EXISTS cpo_select_customer   ON public.customer_pricing_overrides;

CREATE POLICY items_select_member ON public.pricing_menu
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND is_active);
CREATE POLICY items_write_staff ON public.pricing_menu
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops','accounting','sales'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops','accounting','sales'));

CREATE POLICY item_categories_select ON public.item_categories
  FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND is_active);
CREATE POLICY item_categories_write_ops ON public.item_categories
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'));

CREATE POLICY units_select ON public.units
  FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND is_active);
CREATE POLICY units_write_ops ON public.units
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'));

CREATE POLICY warehouses_select_staff ON public.warehouses
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY warehouses_write_ops ON public.warehouses
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'));

CREATE POLICY stock_levels_staff ON public.stock_levels
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops','accounting'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops','accounting'));

CREATE POLICY stock_moves_staff_read ON public.stock_movements
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());

CREATE POLICY tiers_select_member ON public.pricing_tiers
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY tiers_write_staff ON public.pricing_tiers
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','sales'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','sales'));

CREATE POLICY overrides_select_staff ON public.customer_pricing_overrides
  FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY overrides_select_customer ON public.customer_pricing_overrides
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND customer_id = public.current_user_customer_id());
CREATE POLICY overrides_write_sales ON public.customer_pricing_overrides
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','sales'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','sales'));

-- Procurement ----------------------------------------------------------
CREATE POLICY vendors_select_staff ON public.vendors
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY vendors_write_ops_fin ON public.vendors
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops','accounting'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops','accounting'));

CREATE POLICY po_select_staff ON public.purchase_orders
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY po_write_ops ON public.purchase_orders
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'));

CREATE POLICY poli_select_parent ON public.po_line_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_orders po
                  WHERE po.id = po_line_items.po_id
                    AND po.org_id = public.current_org_id()
                    AND public.is_staff()));
CREATE POLICY poli_write_ops ON public.po_line_items
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','ops'));

CREATE POLICY vendor_bills_select_staff ON public.vendor_bills
  FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND public.is_staff());
CREATE POLICY vendor_bills_write_fin ON public.vendor_bills
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting','ops'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin','accounting','ops'));

-- Settings, numbering, audit, idempotency ----------------------------
CREATE POLICY settings_select_member ON public.org_settings
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND NOT is_private);
CREATE POLICY settings_select_staff_private ON public.org_settings
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND is_private AND public.is_staff());
CREATE POLICY settings_write_admin ON public.org_settings
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'));

DROP POLICY IF EXISTS transitions_select_management ON public.audit_log;
CREATE POLICY audit_select_staff ON public.audit_log
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id()
         AND public.current_user_role() IN ('org_owner','org_admin','accounting'));

-- Attachments + saved_views ------------------------------------------
CREATE POLICY attach_select_visible ON public.attachments
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND deleted_at IS NULL
         AND public.attachment_visible_to_caller(entity_type, entity_id));
CREATE POLICY attach_insert_visible ON public.attachments
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_org_id() AND uploaded_by = auth.uid()
              AND public.attachment_visible_to_caller(entity_type, entity_id));
CREATE POLICY attach_delete_uploader_or_admin ON public.attachments
  FOR DELETE TO authenticated
  USING (org_id = public.current_org_id()
         AND (uploaded_by = auth.uid()
              OR public.current_user_role() IN ('org_owner','org_admin')));

CREATE POLICY views_select_personal ON public.saved_views
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND owner_user_id = auth.uid());
CREATE POLICY views_select_team_org ON public.saved_views
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND scope IN ('team','org'));
CREATE POLICY views_write_owner ON public.saved_views
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND owner_user_id = auth.uid())
  WITH CHECK (org_id = public.current_org_id() AND owner_user_id = auth.uid());

COMMIT;
