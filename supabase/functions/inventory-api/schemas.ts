/**
 * inventory-api — request/response Zod re-exports.
 *
 * Single source of truth lives in `../_shared/types.ts` (byte-mirrored
 * into `apps/web/src/lib/types.ts`). This file just re-exports the
 * inventory-api-specific schema names so handler imports stay terse.
 *
 * See TS1/09-api/00-API-CONTRACT.md §9 (inventory).
 */

export {
  ItemSchema,
  ItemCreateSchema,
  ItemPatchSchema,
  ItemKindSchema,
  ItemCategorySchema,
  ItemCategoryCreateSchema,
  ItemCategoryPatchSchema,
  UnitSchema,
  UnitCreateSchema,
  UnitPatchSchema,
  ListMetaSchema,
} from '../_shared/types.ts';
