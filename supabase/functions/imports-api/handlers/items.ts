/**
 * imports-api — /imports/items + /imports/items/commit.
 *
 * CSV columns recognized:
 *   item_code              required
 *   description            required
 *   item_kind              optional, default 'product'
 *   unit_price_cents       optional integer
 *   unit_cost_cents        optional integer
 *   currency_code          optional
 *   is_inventoried         optional boolean
 *   reorder_point          optional number
 *   is_active              optional boolean (default true)
 *
 * Capability gate: inventory.items.write.
 */

import type { ImportRowError } from '../types.ts';
import { importHelpers, makeCommitHandler, makePreviewHandler, type EntityImportDef } from './_factory.ts';

interface ItemInsert {
  org_id: string;
  item_code: string;
  description: string;
  item_kind: string;
  unit_price_cents: number | null;
  unit_cost_cents: number | null;
  currency_code: string | null;
  is_inventoried: boolean | null;
  reorder_point: number | null;
  is_active: boolean;
}

const def: EntityImportDef<ItemInsert> = {
  slug: 'items',
  table: 'items',
  cap: 'inventory.items.write',
  mapRow: (raw, rowIndex, caller) => {
    const errors: ImportRowError[] = [];
    const codeRes = importHelpers.required(raw, 'item_code', rowIndex);
    const descRes = importHelpers.required(raw, 'description', rowIndex);
    let code = '';
    let desc = '';
    if (typeof codeRes === 'string') code = codeRes;
    else errors.push(codeRes);
    if (typeof descRes === 'string') desc = descRes;
    else errors.push(descRes);

    const unitPrice = importHelpers.optionalInt(raw, 'unit_price_cents', rowIndex);
    if (typeof unitPrice === 'object' && unitPrice !== null) errors.push(unitPrice);
    const unitCost = importHelpers.optionalInt(raw, 'unit_cost_cents', rowIndex);
    if (typeof unitCost === 'object' && unitCost !== null) errors.push(unitCost);
    const reorder = importHelpers.optionalNumber(raw, 'reorder_point', rowIndex);
    if (typeof reorder === 'object' && reorder !== null) errors.push(reorder);

    const isActiveRaw = importHelpers.optionalBool(raw, 'is_active');
    const isActive = isActiveRaw === null ? true : isActiveRaw;
    const isInv = importHelpers.optionalBool(raw, 'is_inventoried');

    if (errors.length > 0) return errors;

    return {
      org_id: caller.orgId,
      item_code: code,
      description: desc,
      item_kind: (raw.item_kind ?? 'product').trim() || 'product',
      unit_price_cents: typeof unitPrice === 'number' ? unitPrice : null,
      unit_cost_cents: typeof unitCost === 'number' ? unitCost : null,
      currency_code: importHelpers.optional(raw, 'currency_code'),
      is_inventoried: isInv,
      reorder_point: typeof reorder === 'number' ? reorder : null,
      is_active: isActive,
    };
  },
};

export const previewItems = makePreviewHandler(def);
export const commitItems = makeCommitHandler(def);
