/**
 * crm-api — /customers handlers.
 *
 * Routes per TS1/09-api/00-API-CONTRACT.md §3.1:
 *   GET    /customers                — list (filters: q, status, kind, archived)
 *   POST   /customers                — create
 *   GET    /customers/:id            — detail
 *   PATCH  /customers/:id            — update
 *   POST   /customers/:id/archive    — soft-delete (is_archived=true)
 *   POST   /customers/:id/restore    — undo archive
 *
 * RLS pattern A (org-only) per architecture §2.3. We use the service-role
 * admin client and ALWAYS narrow queries with `.eq('org_id', caller.orgId)`
 * for defense-in-depth.
 *
 * DB column for customer name is `display_name` (post-Wave-6 / migration
 * 0054; previously `name` in the TS-era schema). Wire contract has always
 * used `display_name`; the column rename collapsed the boundary mapping.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  CustomerCreateSchema,
  CustomerPatchSchema,
  CustomerSchema,
  type Customer,
} from '../../_shared/types.ts';
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
import { writeAudit } from '../../_shared/audit.ts';

// `customer_number` is not a column on `public.customers` in the current
// schema; the contract surface still exposes it as nullable so we always
// return `null` here and wire numbering in a future wave.
const CUSTOMER_COLS =
  'id, org_id, display_name, client_type, client_status, email, phone, ' +
  'tax_id, billing_address, shipping_address, currency_code, is_archived, ' +
  'created_at, updated_at';

interface CustomerRow {
  id: string;
  org_id: string;
  display_name: string;
  client_type: string;
  client_status: string;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  billing_address: Record<string, unknown> | null;
  shipping_address: Record<string, unknown> | null;
  currency_code: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

function rowToCustomer(row: CustomerRow): Customer {
  return CustomerSchema.parse({
    id: row.id,
    org_id: row.org_id,
    customer_number: null,
    display_name: row.display_name,
    kind: row.client_type === 'individual' ? 'individual' : 'company',
    client_status: row.client_status,
    primary_email: row.email,
    primary_phone: row.phone,
    tax_id: row.tax_id,
    billing_address: row.billing_address,
    shipping_address: row.shipping_address,
    default_currency_code: row.currency_code,
    is_archived: row.is_archived,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

// ============================================================== GET /customers
export async function listCustomers({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.customers.read');

    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const q = url.searchParams.get('q');
    const status = url.searchParams.get('status');
    const kind = url.searchParams.get('kind');
    const includeArchived = url.searchParams.get('include_archived') === 'true';

    let query = admin()
      .from('customers')
      .select(CUSTOMER_COLS)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (!includeArchived) query = query.eq('is_archived', false);
    if (status) query = query.eq('client_status', status);
    if (kind) query = query.eq('client_type', kind);
    if (q) query = query.ilike('display_name', `%${q}%`);
    if (cursor) {
      // Keyset: rows strictly older than the cursor pair.
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return err('INTERNAL_ERROR', 'customer list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const rows = (data ?? []) as CustomerRow[];
    const { items, next_cursor } = paginate(rows, limit);
    const customers = items.map(rowToCustomer);
    return ok({ items: customers, next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ============================================================ GET /customers/:id
export async function getCustomer({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.customers.read');
    const id = params.id;
    const row = await fetchCustomerRow(caller, id);
    return ok(rowToCustomer(row), undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================== POST /customers
export async function createCustomer({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.customers.write');
    const body = await parseBody(req, CustomerCreateSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /customers',
      body,
      async () => {
        const insertRow = {
          org_id: caller.orgId,
          display_name: body.display_name,
          client_type: body.kind,
          client_status: 'new',
          email: body.primary_email ?? null,
          phone: body.primary_phone ?? null,
          tax_id: body.tax_id ?? null,
          billing_address: body.billing_address ?? {},
          shipping_address: body.shipping_address ?? {},
          currency_code: body.default_currency_code ?? null,
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin()
          .from('customers')
          .insert(insertRow)
          .select(CUSTOMER_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'customer insert failed', 500, {
            detail: error?.message,
          });
        }
        const customer = rowToCustomer(data as CustomerRow);
        // Phase 17 step-8: audit_log write (Wave 10 Session 2 B2).
        await writeAudit({
          actor_user_id: caller.userId,
          org_id: caller.orgId,
          entity_type: 'customer',
          entity_id: customer.id,
          action: 'create',
          after: customer as unknown as Record<string, unknown>,
        });
        return { status: 201, body: { data: customer } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ========================================================= PATCH /customers/:id
export async function patchCustomer({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.customers.write');
    const id = params.id;
    const body = await parseBody(req, CustomerPatchSchema);

    return await respondWithIdempotency(
      req,
      caller,
      `PATCH /customers/:id`,
      body,
      async () => {
        // Confirm visibility before patching so RLS-hidden rows return 404
        // (architecture §0.1 "NOT_FOUND or RLS hid it; indistinguishable").
        const beforeRow = await fetchCustomerRow(caller, id);

        const patch: Record<string, unknown> = { updated_by: caller.userId };
        if (body.display_name !== undefined) patch.display_name = body.display_name;
        if (body.kind !== undefined) patch.client_type = body.kind;
        if (body.primary_email !== undefined) patch.email = body.primary_email;
        if (body.primary_phone !== undefined) patch.phone = body.primary_phone;
        if (body.tax_id !== undefined) patch.tax_id = body.tax_id;
        if (body.billing_address !== undefined) patch.billing_address = body.billing_address ?? {};
        if (body.shipping_address !== undefined)
          patch.shipping_address = body.shipping_address ?? {};
        if (body.default_currency_code !== undefined)
          patch.currency_code = body.default_currency_code;

        const { data, error } = await admin()
          .from('customers')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(CUSTOMER_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'customer update failed', 500, {
            detail: error?.message,
          });
        }
        const after = rowToCustomer(data as CustomerRow);
        // Phase 17 step-8: audit_log write (Wave 10 Session 2 B2).
        await writeAudit({
          actor_user_id: caller.userId,
          org_id: caller.orgId,
          entity_type: 'customer',
          entity_id: id,
          action: 'update',
          before: rowToCustomer(beforeRow) as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
        });
        return { status: 200, body: { data: after } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ================================================== POST /customers/:id/archive
export async function archiveCustomer({ req, params }: Ctx): Promise<Response> {
  return await archiveOrRestore(req, params.id, true);
}

// ================================================== POST /customers/:id/restore
export async function restoreCustomer({ req, params }: Ctx): Promise<Response> {
  return await archiveOrRestore(req, params.id, false);
}

async function archiveOrRestore(
  req: Request,
  id: string,
  archive: boolean,
): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.customers.write');

    return await respondWithIdempotency(
      req,
      caller,
      archive ? 'POST /customers/:id/archive' : 'POST /customers/:id/restore',
      { id, archive },
      async () => {
        await fetchCustomerRow(caller, id);
        const { data, error } = await admin()
          .from('customers')
          .update({ is_archived: archive, updated_by: caller.userId })
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(CUSTOMER_COLS)
          .single();
        if (error || !data) {
          throw new ApiError(
            'INTERNAL_ERROR',
            archive ? 'customer archive failed' : 'customer restore failed',
            500,
            { detail: error?.message },
          );
        }
        // Phase 17 step-8: audit_log write (Wave 10 Session 2 B2).
        await writeAudit({
          actor_user_id: caller.userId,
          org_id: caller.orgId,
          entity_type: 'customer',
          entity_id: id,
          action: archive ? 'archive' : 'restore',
          after: { is_archived: archive },
        });
        return { status: 200, body: { data: rowToCustomer(data as CustomerRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

async function fetchCustomerRow(caller: Caller, id: string): Promise<CustomerRow> {
  const { data, error } = await admin()
    .from('customers')
    .select(CUSTOMER_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'customer lookup failed', 500, { detail: error.message });
  }
  if (!data) {
    throw new ApiError('NOT_FOUND', 'customer not found', 404);
  }
  return data as CustomerRow;
}

