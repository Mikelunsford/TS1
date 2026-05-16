-- 0071_phase22_vendor_portal.sql
-- Purpose: Phase 22 — Vendor portal (Wave 10 Session 4 / Agent C2).
--   Adds the `vendor_user` role + `org_memberships.vendor_id` linkage
--   so external vendor users can sign in and see only their own POs,
--   bills, and AP statements. Adds an `is_vendor_member()` RLS helper
--   and additive vendor-scoped SELECT policies on the procurement
--   tables vendors are entitled to read.
--
-- Coordination: Wave 10 Session 4 ships C1 (Phase 21 customer portal)
-- and C3 (Phase 23 admin console) in parallel. All edits to
-- org_memberships are ADD COLUMN IF NOT EXISTS + new role row so the
-- migrations coexist regardless of merge order.
--
-- DOWN MIGRATION:
--   DROP POLICY IF EXISTS po_select_vendor ON public.purchase_orders;
--   DROP POLICY IF EXISTS poli_select_vendor ON public.po_line_items;
--   DROP POLICY IF EXISTS vendor_bills_select_vendor ON public.vendor_bills;
--   DROP POLICY IF EXISTS vendors_select_vendor ON public.vendors;
--   DROP FUNCTION IF EXISTS public.is_vendor_member(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.current_user_vendor_id();
--   ALTER TABLE public.org_memberships DROP CONSTRAINT IF EXISTS om_role_scope_match;
--   ALTER TABLE public.org_memberships DROP COLUMN IF EXISTS vendor_id;
--   DELETE FROM public.roles WHERE code = 'vendor_user';

BEGIN;

-- 1. Add vendor_user role -------------------------------------------------

INSERT INTO public.roles (code, label, description, is_staff, is_system, scope_level)
VALUES (
  'vendor_user',
  'Vendor Portal',
  'External user scoped to a single vendor record (procurement-side counterpart of customer_user).',
  false, true, 90
)
ON CONFLICT (code) DO NOTHING;

-- 2. Add org_memberships.vendor_id linkage --------------------------------

ALTER TABLE public.org_memberships
  ADD COLUMN IF NOT EXISTS vendor_id uuid NULL REFERENCES public.vendors(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_org_memberships_vendor
  ON public.org_memberships (vendor_id) WHERE vendor_id IS NOT NULL;

-- 3. Tighten the scope-match invariant ------------------------------------
-- The Wave 0 trigger only knew about customer_user; update it to also
-- enforce vendor_user must carry vendor_id (and not customer_id), and
-- staff roles must carry neither.

CREATE OR REPLACE FUNCTION public.check_membership_customer_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r_code text;
BEGIN
  SELECT code INTO r_code FROM public.roles WHERE id = NEW.role_id;
  IF r_code = 'customer_user' THEN
    IF NEW.customer_id IS NULL THEN
      RAISE EXCEPTION 'customer_user membership requires customer_id';
    END IF;
    IF NEW.vendor_id IS NOT NULL THEN
      RAISE EXCEPTION 'customer_user membership must not set vendor_id';
    END IF;
  ELSIF r_code = 'vendor_user' THEN
    IF NEW.vendor_id IS NULL THEN
      RAISE EXCEPTION 'vendor_user membership requires vendor_id';
    END IF;
    IF NEW.customer_id IS NOT NULL THEN
      RAISE EXCEPTION 'vendor_user membership must not set customer_id';
    END IF;
  ELSE
    IF NEW.customer_id IS NOT NULL THEN
      RAISE EXCEPTION 'staff role membership must not set customer_id';
    END IF;
    IF NEW.vendor_id IS NOT NULL THEN
      RAISE EXCEPTION 'staff role membership must not set vendor_id';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- The trigger itself was created in 0029; CREATE OR REPLACE above is enough.

-- 4. RLS helper: is_vendor_member(org_id, vendor_id) ----------------------

CREATE OR REPLACE FUNCTION public.is_vendor_member(p_org_id uuid, p_vendor_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_memberships om
     JOIN public.roles r ON r.id = om.role_id
    WHERE om.org_id    = p_org_id
      AND om.vendor_id = p_vendor_id
      AND om.user_id   = auth.uid()
      AND om.is_active
      AND r.code = 'vendor_user'
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_vendor_member(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_vendor_member(uuid, uuid) TO authenticated, service_role;

-- Convenience: caller's vendor_id (mirrors current_user_customer_id()).

CREATE OR REPLACE FUNCTION public.current_user_vendor_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT om.vendor_id
    FROM public.org_memberships om
   WHERE om.user_id = auth.uid()
     AND om.org_id  = public.current_org_id()
     AND om.is_active
   LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_vendor_id() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_user_vendor_id() TO authenticated, service_role;

-- 5. Vendor-scoped SELECT RLS policies (additive) -------------------------
-- Existing staff policies from 0043 keep working; these add a parallel
-- SELECT path for vendor_user members. Reads are tightly scoped via
-- is_vendor_member(org_id, vendor_id) so a vendor_user can never see
-- another vendor's rows.

-- vendors: vendor_user can SELECT their own vendor row only.
DROP POLICY IF EXISTS vendors_select_vendor ON public.vendors;
CREATE POLICY vendors_select_vendor ON public.vendors
  FOR SELECT TO authenticated
  USING (public.is_vendor_member(org_id, id));

-- purchase_orders: vendor_user can SELECT POs addressed to them.
DROP POLICY IF EXISTS po_select_vendor ON public.purchase_orders;
CREATE POLICY po_select_vendor ON public.purchase_orders
  FOR SELECT TO authenticated
  USING (public.is_vendor_member(org_id, vendor_id));

-- po_line_items: vendor_user can SELECT lines of their POs (join through parent).
DROP POLICY IF EXISTS poli_select_vendor ON public.po_line_items;
CREATE POLICY poli_select_vendor ON public.po_line_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.purchase_orders po
     WHERE po.id = po_line_items.po_id
       AND public.is_vendor_member(po.org_id, po.vendor_id)
  ));

-- vendor_bills: vendor_user can SELECT bills they issued.
DROP POLICY IF EXISTS vendor_bills_select_vendor ON public.vendor_bills;
CREATE POLICY vendor_bills_select_vendor ON public.vendor_bills
  FOR SELECT TO authenticated
  USING (public.is_vendor_member(org_id, vendor_id));

-- 6. Verification block ---------------------------------------------------

DO $verify$
DECLARE
  v_role_exists boolean;
  v_col_exists  boolean;
  v_fn_exists   boolean;
  v_helper_fn   boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.roles WHERE code = 'vendor_user')
    INTO v_role_exists;
  IF NOT v_role_exists THEN
    RAISE EXCEPTION 'verification failed: vendor_user role missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'org_memberships'
       AND column_name  = 'vendor_id'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'verification failed: org_memberships.vendor_id missing';
  END IF;

  SELECT to_regprocedure('public.is_vendor_member(uuid, uuid)') IS NOT NULL
    INTO v_fn_exists;
  IF NOT v_fn_exists THEN
    RAISE EXCEPTION 'verification failed: is_vendor_member(uuid, uuid) missing';
  END IF;

  SELECT to_regprocedure('public.current_user_vendor_id()') IS NOT NULL
    INTO v_helper_fn;
  IF NOT v_helper_fn THEN
    RAISE EXCEPTION 'verification failed: current_user_vendor_id() missing';
  END IF;
END $verify$;

COMMIT;
