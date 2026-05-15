import { describe, expect, it } from 'vitest';

import {
  ItemCategoryCreateSchema,
  ItemCategoryPatchSchema,
  ItemCreateSchema,
  ItemKindSchema,
  ItemPatchSchema,
  UnitCreateSchema,
  UnitPatchSchema,
} from './types';

/**
 * Unit coverage for the Wave-3 inventory Zod schemas. The contract parity
 * test already enforces structural equality between this file and the
 * _shared mirror; these tests pin the semantics callers depend on.
 */

describe('ItemKindSchema', () => {
  it('accepts each of the five kinds', () => {
    for (const kind of ['labor', 'material', 'pass_through', 'fee', 'service'] as const) {
      expect(ItemKindSchema.parse(kind)).toBe(kind);
    }
  });

  it('rejects an unknown kind', () => {
    expect(() => ItemKindSchema.parse('subscription' as never)).toThrow();
  });
});

describe('ItemCreateSchema', () => {
  it('accepts a minimal item', () => {
    const parsed = ItemCreateSchema.parse({ item_code: 'WIDGET-1', description: 'Widget' });
    expect(parsed.item_kind).toBe('material');
    expect(parsed.unit_price_cents).toBe(0);
    expect(parsed.unit_cost_cents).toBe(0);
    expect(parsed.is_inventoried).toBe(false);
    expect(parsed.is_active).toBe(true);
  });

  it('requires non-empty item_code and description', () => {
    expect(() => ItemCreateSchema.parse({ item_code: '', description: 'X' })).toThrow();
    expect(() => ItemCreateSchema.parse({ item_code: 'A', description: '' })).toThrow();
  });

  it('rejects negative prices', () => {
    expect(() =>
      ItemCreateSchema.parse({
        item_code: 'X',
        description: 'Y',
        unit_price_cents: -1,
      }),
    ).toThrow();
    expect(() =>
      ItemCreateSchema.parse({
        item_code: 'X',
        description: 'Y',
        unit_cost_cents: -1,
      }),
    ).toThrow();
  });

  it('accepts a fully populated item with new FK columns', () => {
    const uuid = '00000000-0000-0000-0000-000000000001';
    const parsed = ItemCreateSchema.parse({
      item_code: 'LABOR-STD',
      description: 'Standard labor',
      item_kind: 'labor',
      category_id: uuid,
      unit_price_cents: 12500,
      unit_cost_cents: 8000,
      currency_code: 'USD',
      unit_id: uuid,
      tax_id: uuid,
      is_inventoried: false,
    });
    expect(parsed.item_kind).toBe('labor');
    expect(parsed.currency_code).toBe('USD');
  });
});

describe('ItemPatchSchema', () => {
  it('accepts an empty patch', () => {
    expect(() => ItemPatchSchema.parse({})).not.toThrow();
  });
});

describe('ItemCategoryCreateSchema', () => {
  it('accepts a minimal category', () => {
    const parsed = ItemCategoryCreateSchema.parse({ code: 'tools', label: 'Tools' });
    expect(parsed.is_active).toBe(true);
    expect(parsed.parent_id).toBeUndefined();
  });

  it('accepts a child category with parent_id', () => {
    const uuid = '00000000-0000-0000-0000-000000000001';
    const parsed = ItemCategoryCreateSchema.parse({
      code: 'hand',
      label: 'Hand Tools',
      parent_id: uuid,
    });
    expect(parsed.parent_id).toBe(uuid);
  });

  it('requires non-empty code and label', () => {
    expect(() => ItemCategoryCreateSchema.parse({ code: '', label: 'x' })).toThrow();
    expect(() => ItemCategoryCreateSchema.parse({ code: 'x', label: '' })).toThrow();
  });
});

describe('ItemCategoryPatchSchema', () => {
  it('accepts an empty patch', () => {
    expect(() => ItemCategoryPatchSchema.parse({})).not.toThrow();
  });
});

describe('UnitCreateSchema', () => {
  it('accepts a minimal unit', () => {
    const parsed = UnitCreateSchema.parse({ code: 'each', label: 'Each' });
    expect(parsed.is_active).toBe(true);
    expect(parsed.family).toBeUndefined();
  });

  it('accepts a unit with family', () => {
    const parsed = UnitCreateSchema.parse({ code: 'hr', label: 'Hour', family: 'time' });
    expect(parsed.family).toBe('time');
  });

  it('requires non-empty code and label', () => {
    expect(() => UnitCreateSchema.parse({ code: '', label: 'x' })).toThrow();
  });
});

describe('UnitPatchSchema', () => {
  it('accepts an empty patch', () => {
    expect(() => UnitPatchSchema.parse({})).not.toThrow();
  });
});
