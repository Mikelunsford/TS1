import { describe, it, expect } from 'vitest';

import {
  ExpenseCategoryCreateSchema,
  ExpenseCategoryPatchSchema,
  ExpenseCategorySchema,
} from '@/lib/types';

/**
 * Wire-contract tests for `/finance-api/expense-categories` (Wave 7 /
 * Phase 11). Mirrors `wave3/taxes.test.ts` shape.
 */

const SAMPLE_CATEGORY = {
  id: '00000000-0000-0000-0000-000000000801',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  code: 'TRAVEL',
  label: 'Travel & Entertainment',
  default_account_id: null,
  is_active: true,
  created_at: '2026-05-16T12:00:00+00:00',
  updated_at: '2026-05-16T12:00:00+00:00',
};

describe('Wire contract: /finance-api/expense-categories', () => {
  it('ExpenseCategorySchema accepts the canonical row shape', () => {
    const parsed = ExpenseCategorySchema.safeParse(SAMPLE_CATEGORY);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('ExpenseCategorySchema requires non-empty code + label', () => {
    expect(
      ExpenseCategorySchema.safeParse({ ...SAMPLE_CATEGORY, code: '' }).success,
    ).toBe(false);
    expect(
      ExpenseCategorySchema.safeParse({ ...SAMPLE_CATEGORY, label: '' }).success,
    ).toBe(false);
  });

  it('ExpenseCategoryCreateSchema accepts the minimum-required body', () => {
    expect(
      ExpenseCategoryCreateSchema.safeParse({ code: 'TRAVEL', label: 'Travel' }).success,
    ).toBe(true);
  });

  it('ExpenseCategoryCreateSchema rejects missing required fields', () => {
    expect(ExpenseCategoryCreateSchema.safeParse({ code: 'X' }).success).toBe(false);
    expect(ExpenseCategoryCreateSchema.safeParse({ label: 'X' }).success).toBe(false);
    expect(ExpenseCategoryCreateSchema.safeParse({}).success).toBe(false);
  });

  it('ExpenseCategoryCreateSchema bounds code at 1..64 and label at 1..255', () => {
    expect(
      ExpenseCategoryCreateSchema.safeParse({
        code: 'x'.repeat(65),
        label: 'Travel',
      }).success,
    ).toBe(false);
    expect(
      ExpenseCategoryCreateSchema.safeParse({
        code: 'TRAVEL',
        label: 'x'.repeat(256),
      }).success,
    ).toBe(false);
  });

  it('ExpenseCategoryCreateSchema is strict — rejects unknown keys', () => {
    expect(
      ExpenseCategoryCreateSchema.safeParse({
        code: 'TRAVEL',
        label: 'Travel',
        surprise: true,
      }).success,
    ).toBe(false);
  });

  it('ExpenseCategoryPatchSchema accepts a partial body and an empty body', () => {
    expect(ExpenseCategoryPatchSchema.safeParse({}).success).toBe(true);
    expect(ExpenseCategoryPatchSchema.safeParse({ label: 'updated' }).success).toBe(true);
    expect(ExpenseCategoryPatchSchema.safeParse({ is_active: false }).success).toBe(true);
  });

  it('ExpenseCategoryPatchSchema rejects code (immutable per handler)', () => {
    // The patch schema deliberately omits `code` — the handler treats it as
    // immutable after creation to keep the org-scoped code uniqueness stable.
    expect(ExpenseCategoryPatchSchema.safeParse({ code: 'X' }).success).toBe(false);
  });

  it('ExpenseCategoryPatchSchema is strict — rejects unknown keys', () => {
    expect(ExpenseCategoryPatchSchema.safeParse({ surprise: 1 }).success).toBe(false);
  });
});
