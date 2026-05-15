/**
 * crm-api — /contacts handlers.
 *
 * Routes per TS1/09-api/00-API-CONTRACT.md §3.2:
 *   GET    /contacts?customer_id=...   — list, customer filter
 *   POST   /contacts                   — create
 *   GET    /contacts/:id               — detail
 *   PATCH  /contacts/:id               — update
 *   DELETE /contacts/:id               — hard-delete (cascades nothing)
 *
 * RLS pattern A. Defense-in-depth: every query carries `.eq('org_id', ...)`.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { ContactSchema, ContactUpsertSchema, type Contact } from '../../_shared/types.ts';
import {
  admin,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  requireCap,
  respondWithIdempotency,
  type Caller,
} from '../_helpers.ts';

const CONTACT_COLS =
  'id, org_id, customer_id, first_name, last_name, email, phone, title, ' +
  'is_primary, is_active, created_at, updated_at';

interface ContactRow {
  id: string;
  org_id: string;
  customer_id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function rowToContact(row: ContactRow): Contact {
  return ContactSchema.parse(row);
}

// =============================================================== GET /contacts
export async function listContacts({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.contacts.read');

    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const customerId = url.searchParams.get('customer_id');

    let query = admin()
      .from('contacts')
      .select(CONTACT_COLS)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (customerId) query = query.eq('customer_id', customerId);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await query;
    if (error) {
      return err('INTERNAL_ERROR', 'contact list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const rows = (data ?? []) as ContactRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToContact), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ============================================================ GET /contacts/:id
export async function getContact({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.contacts.read');
    const row = await fetchContactRow(caller, params.id);
    return ok(rowToContact(row), undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ============================================================= POST /contacts
export async function createContact({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.contacts.write');
    const body = await parseBody(req, ContactUpsertSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /contacts',
      body,
      async () => {
        // Ensure the customer is visible to the caller's org.
        const { data: customer, error: cErr } = await admin()
          .from('customers')
          .select('id')
          .eq('id', body.customer_id)
          .eq('org_id', caller.orgId)
          .maybeSingle();
        if (cErr) {
          throw new ApiError('INTERNAL_ERROR', 'customer lookup failed', 500, {
            detail: cErr.message,
          });
        }
        if (!customer) {
          throw new ApiError('VALIDATION_ERROR', 'customer_id not found in caller org', 422);
        }

        const insertRow = {
          org_id: caller.orgId,
          customer_id: body.customer_id,
          first_name: body.first_name,
          last_name: body.last_name ?? '',
          email: body.email ?? null,
          phone: body.phone ?? null,
          title: body.title ?? null,
          is_primary: body.is_primary,
          created_by: caller.userId,
        };
        const { data, error } = await admin()
          .from('contacts')
          .insert(insertRow)
          .select(CONTACT_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'contact insert failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 201, body: { data: rowToContact(data as ContactRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ========================================================== PATCH /contacts/:id
export async function patchContact({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.contacts.write');
    const body = await parseBody(req, ContactUpsertSchema.partial());
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /contacts/:id',
      body,
      async () => {
        await fetchContactRow(caller, id);
        const patch: Record<string, unknown> = { updated_by: caller.userId };
        if (body.first_name !== undefined) patch.first_name = body.first_name;
        if (body.last_name !== undefined) patch.last_name = body.last_name ?? '';
        if (body.email !== undefined) patch.email = body.email;
        if (body.phone !== undefined) patch.phone = body.phone;
        if (body.title !== undefined) patch.title = body.title;
        if (body.is_primary !== undefined) patch.is_primary = body.is_primary;

        const { data, error } = await admin()
          .from('contacts')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(CONTACT_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'contact update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToContact(data as ContactRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ========================================================= DELETE /contacts/:id
export async function deleteContact({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.contacts.write');
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'DELETE /contacts/:id',
      { id },
      async () => {
        await fetchContactRow(caller, id);
        // Contract §3.2 specifies hard delete (cascades nothing).
        const { error } = await admin()
          .from('contacts')
          .delete()
          .eq('id', id)
          .eq('org_id', caller.orgId);
        if (error) {
          throw new ApiError('INTERNAL_ERROR', 'contact delete failed', 500, {
            detail: error.message,
          });
        }
        return { status: 200, body: { data: { ok: true } } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

async function fetchContactRow(caller: Caller, id: string): Promise<ContactRow> {
  const { data, error } = await admin()
    .from('contacts')
    .select(CONTACT_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'contact lookup failed', 500, { detail: error.message });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'contact not found', 404);
  return data as ContactRow;
}
