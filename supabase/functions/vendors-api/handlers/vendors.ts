/**
 * vendors-api — /vendors handlers (Wave 7 / Phase 10).
 *
 * Vendor CRUD over the Wave 0 chassis `public.vendors` table. RLS Pattern A
 * (staff R + ops/accounting W). Soft-delete via `deleted_at`; the "archive"
 * route flips `is_active=false` (matches the Wave 4 customers pattern; no
 * row deletion). `vendors.name` is the canonical display field — vendors
 * were NOT part of the F-Wave6-03 customers.display_name rename (see D-W7-4
 * in the Wave 7 dispatch plan).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  admin,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  requireCap,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import {
  VendorCreateSchema,
  VendorPatchSchema,
} from '../../_shared/types.ts';

const BUNDLE = 'vendors-api';
const VENDOR_COLS =
  'id, org_id, name, legal_name, email, phone, website, tax_id, currency_code, ' +
  'payment_terms_days, billing_address, external_ref, notes, is_active, ' +
  'created_at, updated_at, deleted_at';

export async function listVendors({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'vendors.read');
  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const q = url.searchParams.get('q');
  const activeRaw = url.searchParams.get('is_active');

  let qb = admin()
    .from('vendors')
    .select(VENDOR_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (q) qb = qb.ilike('name', `%${q}%`);
  if (activeRaw === 'true') qb = qb.eq('is_active', true);
  if (activeRaw === 'false') qb = qb.eq('is_active', false);
  if (cursor) {
    qb = qb.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await qb;
  if (error) throw new ApiError('INTERNAL_ERROR', 'failed to list vendors', 500, { db: error.message });
  return ok(paginate(data ?? [], limit), undefined, { req });
}

export async function createVendor({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'vendors.write');
  const body = await parseBody(req, VendorCreateSchema);

  return respondWithIdempotency(req, caller, BUNDLE, 'POST /vendors', body, async () => {
    const { data, error } = await admin()
      .from('vendors')
      .insert({
        org_id: caller.orgId,
        name: body.name,
        legal_name: body.legal_name ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        website: body.website ?? null,
        tax_id: body.tax_id ?? null,
        currency_code: body.currency_code ?? null,
        payment_terms_days: body.payment_terms_days ?? 30,
        billing_address: body.billing_address ?? {},
        external_ref: body.external_ref ?? null,
        notes: body.notes ?? null,
        is_active: true,
        created_by: caller.userId,
        updated_by: caller.userId,
      })
      .select(VENDOR_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to create vendor', 500, { db: error.message });
    return { status: 201, body: { data } };
  });
}

export async function getVendor({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'vendors.read');
  const { data, error } = await admin()
    .from('vendors')
    .select(VENDOR_COLS)
    .eq('org_id', caller.orgId)
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new ApiError('INTERNAL_ERROR', 'failed to load vendor', 500, { db: error.message });
  if (!data) throw new ApiError('NOT_FOUND', 'vendor not found', 404);
  return ok(data, undefined, { req });
}

export async function patchVendor({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'vendors.write');
  const body = await parseBody(req, VendorPatchSchema);

  return respondWithIdempotency(req, caller, BUNDLE, `PATCH /vendors/${params.id}`, body, async () => {
    const patch: Record<string, unknown> = { updated_by: caller.userId, updated_at: new Date().toISOString() };
    for (const k of [
      'name', 'legal_name', 'email', 'phone', 'website', 'tax_id', 'currency_code',
      'payment_terms_days', 'billing_address', 'external_ref', 'notes', 'is_active',
    ] as const) {
      if (k in body) patch[k] = (body as Record<string, unknown>)[k];
    }
    const { data, error } = await admin()
      .from('vendors')
      .update(patch)
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .is('deleted_at', null)
      .select(VENDOR_COLS)
      .single();
    if (error) {
      if ((error as { code?: string }).code === 'PGRST116') {
        throw new ApiError('NOT_FOUND', 'vendor not found', 404);
      }
      throw new ApiError('INTERNAL_ERROR', 'failed to update vendor', 500, { db: error.message });
    }
    return { status: 200, body: { data } };
  });
}

export async function archiveVendor({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'vendors.write');

  return respondWithIdempotency(req, caller, BUNDLE, `POST /vendors/${params.id}/archive`, {}, async () => {
    const { data, error } = await admin()
      .from('vendors')
      .update({ is_active: false, updated_by: caller.userId, updated_at: new Date().toISOString() })
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .is('deleted_at', null)
      .select(VENDOR_COLS)
      .maybeSingle();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to archive vendor', 500, { db: error.message });
    if (!data) throw new ApiError('NOT_FOUND', 'vendor not found', 404);
    return { status: 200, body: { data } };
  });
}
