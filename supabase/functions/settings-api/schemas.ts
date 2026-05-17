/**
 * settings-api — request/response schemas (Phase 15).
 */
import { z } from 'https://esm.sh/zod@3.23.8';

export const SettingsKey = z.string().min(1).max(128);
export const SettingsGroup = z.string().min(1).max(64);
export const SettingsValue: z.ZodType<unknown> = z.unknown();

export const SettingUpsertSchema = z.object({
  value: SettingsValue,
});

export const SettingsBulkItemSchema = z.object({
  group: SettingsGroup,
  key: SettingsKey,
  value: SettingsValue,
});

export const SettingsBulkSchema = z.object({
  items: z.array(SettingsBulkItemSchema).min(1).max(200),
});

// R-W11-NUMBERING-01 — field names mirror the prod numbering_sequences columns
// (pad_width / reset_period), NOT the original Phase-15 dispatch's pad/auto_reset
// shape which never matched what migration 0034 actually shipped.
export const NumberingPutSchema = z.object({
  prefix: z.string().max(16).optional(),
  pad_width: z.number().int().min(0).max(12).optional(),
  reset_period: z.enum(['never', 'yearly', 'monthly']).optional(),
}).strict();
