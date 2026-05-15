/**
 * crm-api — /activities handlers.
 *
 * Routes per TS1/09-api/00-API-CONTRACT.md §3.5:
 *   GET    /activities?entity_type=&entity_id=  — polymorphic timeline
 *   POST   /activities                          — log call/meeting/email/note/task
 *   PATCH  /activities/:id                      — edit
 *
 * The DB shape (post-rename in migration 0032) is a flat table `activities`
 * with separate FK columns (`customer_id` NOT NULL, `contact_id`, `quote_id`,
 * `project_id`, `lead_id`, `opportunity_id`). The wire contract is
 * polymorphic (entity_type + entity_id). We resolve customer_id from the
 * referenced entity at insert time and set the matching FK column.
 *
 * Wave 2 scope: entity_type ∈ {customer, contact, lead, opportunity}. The
 * project/quote/invoice surfaces are Wave 3+; logging activities against them
 * via this handler is rejected for now to keep the contract honest.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  ActivityCreateSchema,
  ActivityPatchSchema,
  ActivitySchema,
  type Activity,
  type ActivityEntityType,
  type ActivityKind,
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

const ACTIVITY_COLS =
  'id, org_id, customer_id, contact_id, lead_id, opportunity_id, ' +
  'activity_type, subject, body, status, due_at, completed_at, ' +
  'created_at, updated_at';

interface ActivityRow {
  id: string;
  org_id: string;
  customer_id: string;
  contact_id: string | null;
  lead_id: string | null;
  opportunity_id: string | null;
  activity_type: string;
  subject: string;
  body: string | null;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToActivity(row: ActivityRow): Activity {
  let entity_type: ActivityEntityType;
  let entity_id: string;
  if (row.lead_id) {
    entity_type = 'lead';
    entity_id = row.lead_id;
  } else if (row.opportunity_id) {
    entity_type = 'opportunity';
    entity_id = row.opportunity_id;
  } else if (row.contact_id) {
    entity_type = 'contact';
    entity_id = row.contact_id;
  } else {
    entity_type = 'customer';
    entity_id = row.customer_id;
  }
  return ActivitySchema.parse({
    id: row.id,
    org_id: row.org_id,
    entity_type,
    entity_id,
    kind: row.activity_type as ActivityKind,
    subject: row.subject,
    body: row.body,
    status: row.status,
    due_at: row.due_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

// ============================================================== GET /activities
export async function listActivities({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.activities.read');
    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const entityType = url.searchParams.get('entity_type');
    const entityId = url.searchParams.get('entity_id');

    let query = admin()
      .from('activities')
      .select(ACTIVITY_COLS)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (entityType && entityId) {
      switch (entityType) {
        case 'customer':
          query = query.eq('customer_id', entityId);
          break;
        case 'contact':
          query = query.eq('contact_id', entityId);
          break;
        case 'lead':
          query = query.eq('lead_id', entityId);
          break;
        case 'opportunity':
          query = query.eq('opportunity_id', entityId);
          break;
        default:
          return err(
            'VALIDATION_ERROR',
            `entity_type=${entityType} not supported by Wave 2 activities surface`,
            undefined,
            422,
            { req },
          );
      }
    }
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await query;
    if (error) {
      return err('INTERNAL_ERROR', 'activity list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const rows = (data ?? []) as ActivityRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToActivity), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ============================================================ POST /activities
export async function createActivity({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.activities.write');
    const body = await parseBody(req, ActivityCreateSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /activities',
      body,
      async () => {
        const resolved = await resolveActivityEntity(caller, body.entity_type, body.entity_id);
        const status = body.completed_at ? 'completed' : 'open';
        const { data, error } = await admin()
          .from('activities')
          .insert({
            org_id: caller.orgId,
            customer_id: resolved.customer_id,
            contact_id: resolved.contact_id,
            lead_id: resolved.lead_id,
            opportunity_id: resolved.opportunity_id,
            activity_type: body.kind,
            subject: body.subject,
            body: body.body ?? null,
            status,
            due_at: body.due_at ?? null,
            completed_at: body.completed_at ?? null,
            assigned_to: caller.userId,
            created_by: caller.userId,
          })
          .select(ACTIVITY_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'activity insert failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 201, body: { data: rowToActivity(data as ActivityRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ========================================================= PATCH /activities/:id
export async function patchActivity({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.activities.write');
    const body = await parseBody(req, ActivityPatchSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /activities/:id',
      body,
      async () => {
        // Confirm visibility first.
        const { data: existing, error: eErr } = await admin()
          .from('activities')
          .select('id')
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .is('deleted_at', null)
          .maybeSingle();
        if (eErr) {
          throw new ApiError('INTERNAL_ERROR', 'activity lookup failed', 500, {
            detail: eErr.message,
          });
        }
        if (!existing) throw new ApiError('NOT_FOUND', 'activity not found', 404);

        const patch: Record<string, unknown> = {};
        if (body.subject !== undefined) patch.subject = body.subject;
        if (body.body !== undefined) patch.body = body.body;
        if (body.due_at !== undefined) patch.due_at = body.due_at;
        if (body.completed_at !== undefined) patch.completed_at = body.completed_at;
        if (body.status !== undefined) patch.status = body.status;
        // If completed_at is set and status is not explicitly transitioned,
        // bump status to 'completed' to satisfy the activities check constraint.
        if (body.completed_at && body.status === undefined) {
          patch.status = 'completed';
        }

        const { data, error } = await admin()
          .from('activities')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(ACTIVITY_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'activity update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToActivity(data as ActivityRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

interface ResolvedEntity {
  customer_id: string;
  contact_id: string | null;
  lead_id: string | null;
  opportunity_id: string | null;
}

/**
 * Resolve the polymorphic wire shape (entity_type, entity_id) to the flat
 * column layout on the `activities` table. `customer_id` is NOT NULL on the
 * DB row, so we walk the reference and pin it. Returns the inserted FK set.
 *
 * For lead with no converted_customer_id we fail with VALIDATION_ERROR; the
 * caller can convert the lead first or attach the activity directly to a
 * customer/contact.
 */
async function resolveActivityEntity(
  caller: Caller,
  entityType: ActivityEntityType,
  entityId: string,
): Promise<ResolvedEntity> {
  if (entityType === 'customer') {
    const { data } = await admin()
      .from('customers')
      .select('id')
      .eq('id', entityId)
      .eq('org_id', caller.orgId)
      .maybeSingle();
    if (!data) throw new ApiError('NOT_FOUND', 'customer not found', 404);
    return { customer_id: entityId, contact_id: null, lead_id: null, opportunity_id: null };
  }
  if (entityType === 'contact') {
    const { data } = await admin()
      .from('contacts')
      .select('id, customer_id')
      .eq('id', entityId)
      .eq('org_id', caller.orgId)
      .maybeSingle();
    if (!data) throw new ApiError('NOT_FOUND', 'contact not found', 404);
    return {
      customer_id: data.customer_id as string,
      contact_id: entityId,
      lead_id: null,
      opportunity_id: null,
    };
  }
  if (entityType === 'opportunity') {
    const { data } = await admin()
      .from('opportunities')
      .select('id, customer_id')
      .eq('id', entityId)
      .eq('org_id', caller.orgId)
      .maybeSingle();
    if (!data) throw new ApiError('NOT_FOUND', 'opportunity not found', 404);
    return {
      customer_id: data.customer_id as string,
      contact_id: null,
      lead_id: null,
      opportunity_id: entityId,
    };
  }
  if (entityType === 'lead') {
    const { data } = await admin()
      .from('leads')
      .select('id, converted_customer_id')
      .eq('id', entityId)
      .eq('org_id', caller.orgId)
      .maybeSingle();
    if (!data) throw new ApiError('NOT_FOUND', 'lead not found', 404);
    const customerId = data.converted_customer_id as string | null;
    if (!customerId) {
      throw new ApiError(
        'VALIDATION_ERROR',
        'lead has no converted_customer_id; convert the lead or log the activity against a customer/contact',
        422,
      );
    }
    return {
      customer_id: customerId,
      contact_id: null,
      lead_id: entityId,
      opportunity_id: null,
    };
  }
  throw new ApiError(
    'VALIDATION_ERROR',
    `entity_type=${entityType} not supported by Wave 2 activities surface`,
    422,
  );
}
