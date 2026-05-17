/**
 * Settings service (Phase 15). Talks to settings-api.
 */
import { z } from 'zod';

import { apiRequest } from '../apiClient';

const FlagsResponse = z.object({ flags: z.record(z.string(), z.boolean()) });
const AllGroupsResponse = z.object({ groups: z.record(z.string(), z.record(z.string(), z.unknown())) });
const GroupResponse = z.object({
  group: z.string(),
  values: z.record(z.string(), z.unknown()),
});
const UpsertResponse = z.object({
  group: z.string(),
  key: z.string(),
  value: z.unknown(),
});
const BulkResponse = z.object({ applied: z.number().int() });

// R-W11-NUMBERING-01 — field names mirror the prod `numbering_sequences`
// columns (doc_type / pad_width / reset_period). The legacy `kind` / `pad` /
// `auto_reset` shape never matched what migration 0034 shipped.
const NumberingItem = z.object({
  doc_type: z.string(),
  prefix: z.string().nullable().optional(),
  pad_width: z.number().int().nullable().optional(),
  reset_period: z.enum(['never', 'yearly', 'monthly']).nullable().optional(),
  current_value: z.number().int().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});
const NumberingListResponse = z.object({ items: z.array(NumberingItem) });

export type FlagMap = z.infer<typeof FlagsResponse>['flags'];
export type SettingsGroups = z.infer<typeof AllGroupsResponse>['groups'];
export type NumberingRow = z.infer<typeof NumberingItem>;

export async function getFlags(): Promise<FlagMap> {
  const res = await apiRequest({
    path: '/settings-api/settings/me/flags',
    method: 'GET',
    schema: FlagsResponse,
  });
  return res.flags;
}

export async function getAllSettings(): Promise<SettingsGroups> {
  const res = await apiRequest({
    path: '/settings-api/settings/me/all',
    method: 'GET',
    schema: AllGroupsResponse,
  });
  return res.groups;
}

export async function getSettingsGroup(group: string): Promise<Record<string, unknown>> {
  const res = await apiRequest({
    path: `/settings-api/settings/${encodeURIComponent(group)}`,
    method: 'GET',
    schema: GroupResponse,
  });
  return res.values;
}

export async function upsertSetting(group: string, key: string, value: unknown) {
  return apiRequest({
    path: `/settings-api/settings/${encodeURIComponent(group)}/${encodeURIComponent(key)}`,
    method: 'PUT',
    body: { value },
    schema: UpsertResponse,
  });
}

export async function bulkUpdateSettings(items: Array<{ group: string; key: string; value: unknown }>) {
  return apiRequest({
    path: '/settings-api/settings/bulk-update',
    method: 'POST',
    body: { items },
    schema: BulkResponse,
  });
}

export async function listNumbering(): Promise<NumberingRow[]> {
  const res = await apiRequest({
    path: '/settings-api/settings/numbering',
    method: 'GET',
    schema: NumberingListResponse,
  });
  return res.items;
}

export async function updateNumbering(
  docType: string,
  patch: { prefix?: string; pad_width?: number; reset_period?: 'never' | 'yearly' | 'monthly' },
) {
  return apiRequest({
    path: `/settings-api/settings/numbering/${encodeURIComponent(docType)}`,
    method: 'PUT',
    body: patch,
    schema: NumberingItem,
  });
}
