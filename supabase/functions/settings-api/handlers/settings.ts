/**
 * settings-api — /settings handlers (Phase 15).
 *
 * Endpoints:
 *   GET  /settings/:group        — flat key/value object for one group
 *   GET  /settings/me/all        — nested {group:{key:value}} for caller's org
 *   PUT  /settings/:group/:key   — upsert one (admin+, idempotency-key required)
 *   POST /settings/bulk-update   — array upsert (admin+, idempotency-key required)
 *
 * RLS: explicit `.eq('org_id', caller.orgId)` per Pattern A. Reads allowed
 * for any org member; writes restricted to org_admin+ via `requireCap`.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, parseBody, requireCap, respondWithIdempotency } from '../_helpers.ts';
import {
  SettingUpsertSchema,
  SettingsBulkSchema,
} from '../schemas.ts';

const BUNDLE = 'settings-api';

interface SettingsRow {
  org_id: string;
  group: string;
  key: string;
  value: unknown;
  created_at: string;
  updated_at: string;
}

export async function listSettingsByGroup({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'org.settings.read');
  const group = params.group;
  if (!group) throw new ApiError('VALIDATION_ERROR', 'group is required', 422);

  const { data, error } = await admin()
    .from('org_settings')
    .select('key, value, created_at, updated_at')
    .eq('org_id', caller.orgId)
    .eq('group', group);

  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'org_settings list failed', 500, { detail: error.message });
  }

  const out: Record<string, unknown> = {};
  for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
    out[row.key] = row.value;
  }
  return ok({ group, values: out }, undefined, { req });
}

export async function getAllSettingsForMe({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'org.settings.read');

  const { data, error } = await admin()
    .from('org_settings')
    .select('group, key, value')
    .eq('org_id', caller.orgId);

  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'org_settings list failed', 500, { detail: error.message });
  }

  const grouped: Record<string, Record<string, unknown>> = {};
  for (const row of (data ?? []) as Array<{ group: string; key: string; value: unknown }>) {
    if (!grouped[row.group]) grouped[row.group] = {};
    grouped[row.group][row.key] = row.value;
  }
  return ok({ groups: grouped }, undefined, { req });
}

export async function upsertSetting({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'org.settings.write');
  const group = params.group;
  const key = params.key;
  if (!group || !key) throw new ApiError('VALIDATION_ERROR', 'group + key required', 422);
  const body = await parseBody(req, SettingUpsertSchema);

  return respondWithIdempotency(req, caller, `PUT /settings/${group}/${key}`, body, async () => {
    const sb = admin();
    const { error } = await sb
      .from('org_settings')
      .upsert(
        {
          org_id: caller.orgId,
          group,
          key,
          value: body.value as unknown,
          updated_by: caller.userId,
        },
        { onConflict: 'org_id,group,key' },
      );
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'org_settings upsert failed', 500, { detail: error.message });
    }
    return { status: 200, body: { data: { group, key, value: body.value } } };
  });
}

export async function bulkUpdateSettings({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'org.settings.write');
  const body = await parseBody(req, SettingsBulkSchema);

  return respondWithIdempotency(req, caller, 'POST /settings/bulk-update', body, async () => {
    const sb = admin();
    const rows = body.items.map((it) => ({
      org_id: caller.orgId,
      group: it.group,
      key: it.key,
      value: it.value as unknown,
      updated_by: caller.userId,
    }));
    const { error } = await sb
      .from('org_settings')
      .upsert(rows, { onConflict: 'org_id,group,key' });
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'org_settings bulk upsert failed', 500, { detail: error.message });
    }
    return { status: 200, body: { data: { applied: rows.length } } };
  });
}
