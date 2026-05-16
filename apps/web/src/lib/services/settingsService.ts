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

const NumberingItem = z.object({
  kind: z.string(),
  prefix: z.string().nullable().optional(),
  pad: z.number().int().nullable().optional(),
  auto_reset: z.string().nullable().optional(),
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
  kind: string,
  patch: { prefix?: string; pad?: number; auto_reset?: 'never' | 'yearly' | 'monthly' },
) {
  return apiRequest({
    path: `/settings-api/settings/numbering/${encodeURIComponent(kind)}`,
    method: 'PUT',
    body: patch,
    schema: NumberingItem,
  });
}
